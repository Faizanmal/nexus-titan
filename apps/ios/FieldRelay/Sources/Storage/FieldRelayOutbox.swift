import Foundation

public enum OutboxStatus: String, Codable, Sendable {
    case draft = "draft"
    case redacted = "redacted"
    case approvedForSync = "approved_for_sync"
    case synced = "synced"
    case rejected = "rejected"
}

public struct OutboxRecord: Identifiable, Codable, Sendable {
    public let id: String
    public let assetId: String
    public let encryptedPayload: Data
    public var status: OutboxStatus
    public let createdAt: Date
    public var syncedAt: Date?

    public init(
        id: String = UUID().uuidString,
        assetId: String,
        encryptedPayload: Data,
        status: OutboxStatus = .draft,
        createdAt: Date = Date(),
        syncedAt: Date? = nil
    ) {
        self.id = id
        self.assetId = assetId
        self.encryptedPayload = encryptedPayload
        self.status = status
        self.createdAt = createdAt
        self.syncedAt = syncedAt
    }
}

/// Actor managing local SQLite / in-memory transactional outbox.
/// Strictly flushes approved records to the server API; never performs local AI inference.
public actor FieldRelayOutboxManager {
    public static let shared = FieldRelayOutboxManager()

    private var storage: [String: OutboxRecord] = [:]
    private let vault = KeychainVault.shared

    public init() {}

    public func insert(assetId: String, plaintextPayload: Data, status: OutboxStatus = .draft) throws -> OutboxRecord {
        let encrypted = try vault.encrypt(plaintext: plaintextPayload)
        let record = OutboxRecord(assetId: assetId, encryptedPayload: encrypted, status: status)
        storage[record.id] = record
        return record
    }

    public func updateStatus(id: String, newStatus: OutboxStatus) {
        guard var record = storage[id] else { return }
        record.status = newStatus
        if newStatus == .synced {
            record.syncedAt = Date()
        }
        storage[id] = record
    }

    public func getApprovedSyncRecords() -> [OutboxRecord] {
        return storage.values
            .filter { $0.status == .approvedForSync }
            .sorted { $0.createdAt < $1.createdAt }
    }

    public func getAllRecords() -> [OutboxRecord] {
        return storage.values.sorted { $0.createdAt > $1.createdAt }
    }

    public func getPendingCount() -> Int {
        return storage.values.filter { $0.status == .approvedForSync }.count
    }

    /// Flushes approved records to the server `/sync/events` endpoint.
    /// Strictly handles network synchronization only; no local AI execution.
    public func flushPendingSync(serverBaseURL: URL) async throws -> Int {
        let pending = getApprovedSyncRecords()
        guard !pending.isEmpty else { return 0 }

        var syncedCount = 0
        let session = URLSession.shared

        for record in pending {
            do {
                let decrypted = try vault.decrypt(ciphertext: record.encryptedPayload)
                var request = URLRequest(url: serverBaseURL.appendingPathComponent("/sync/events"))
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(record.id, forHTTPHeaderField: "X-Titan-Client-Device")
                request.httpBody = decrypted

                let (_, response) = try await session.data(for: request)
                if let httpResponse = response as? HTTPURLResponse {
                    if (200...299).contains(httpResponse.statusCode) {
                        updateStatus(id: record.id, newStatus: .synced)
                        syncedCount += 1
                    } else if (400...499).contains(httpResponse.statusCode) {
                        updateStatus(id: record.id, newStatus: .rejected)
                    }
                }
            } catch {
                // Network error - remains approved_for_sync for next retry
                continue
            }
        }
        return syncedCount
    }
}
