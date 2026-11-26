import Foundation
import Security
import CryptoKit

/// Hardware-backed cryptographic vault utilizing the iOS Keychain and CryptoKit AES-GCM.
/// Protects offline outbox entries, tokens, and cryptographic identity keys on the device.
public final class KeychainVault: Sendable {
    public static let shared = KeychainVault()

    private let serviceName = "dev.nexustitan.fieldrelay.vault"
    private let masterKeyAccount = "nexus_titan_master_key_v1"

    public init() {}

    /// Retrieves existing master AES-256 key from Keychain or generates and securely saves a new one.
    public func getOrCreateMasterKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: masterKeyAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecSuccess, let keyData = item as? Data {
            return SymmetricKey(data: keyData)
        } else if status == errSecItemNotFound {
            // Generate a fresh 256-bit AES symmetric key
            let newKey = SymmetricKey(size: .bits256)
            let keyData = newKey.withUnsafeBytes { Data($0) }

            let addQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: serviceName,
                kSecAttrAccount as String: masterKeyAccount,
                kSecValueData as String: keyData,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            ]

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.keyGenerationFailed(status: addStatus)
            }
            return newKey
        } else {
            throw KeychainError.retrievalFailed(status: status)
        }
    }

    /// Encrypts plaintext bytes using AES-GCM with a 12-byte random nonce and 128-bit authentication tag.
    public func encrypt(plaintext: Data) throws -> Data {
        let key = try getOrCreateMasterKey()
        let sealedBox = try AES.GCM.seal(plaintext, using: key)
        guard let combined = sealedBox.combined else {
            throw KeychainError.encryptionFailed
        }
        return combined
    }

    /// Decrypts AES-GCM sealed box data back to plaintext.
    public func decrypt(ciphertext: Data) throws -> Data {
        let key = try getOrCreateMasterKey()
        let sealedBox = try AES.GCM.SealedBox(combined: ciphertext)
        return try AES.GCM.open(sealedBox, using: key)
    }

    public enum KeychainError: Error, LocalizedError {
        case keyGenerationFailed(status: OSStatus)
        case retrievalFailed(status: OSStatus)
        case encryptionFailed
        case decryptionFailed

        public var errorDescription: String? {
            switch self {
            case .keyGenerationFailed(let status):
                return "Failed to generate or save Keychain master key (OSStatus: \(status))."
            case .retrievalFailed(let status):
                return "Failed to retrieve Keychain master key (OSStatus: \(status))."
            case .encryptionFailed:
                return "AES-GCM encryption failed to produce sealed box."
            case .decryptionFailed:
                return "AES-GCM decryption failed to authenticate or open sealed box."
            }
        }
    }
}
