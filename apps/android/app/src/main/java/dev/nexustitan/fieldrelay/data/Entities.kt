package dev.nexustitan.fieldrelay.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_outbox")
data class OutboxItem(
    @PrimaryKey
    val id: String,
    val tenantId: String,
    val siteId: String,
    val eventType: String,
    val encryptedPayload: String, // Encrypted with AndroidKeystoreVault
    val classification: String,   // PUBLIC, INTERNAL, RESTRICTED
    val status: String,           // provisional, approved_for_sync, synced, rejected
    val retryCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val syncedAt: Long? = null
)

@Entity(tableName = "cached_assets")
data class CachedAsset(
    @PrimaryKey
    val assetId: String,
    val label: String,
    val assetType: String,
    val subsystemId: String,
    val criticality: String,
    val qrMarkerId: String,
    val positionEast: Double,
    val positionNorth: Double,
    val positionUp: Double,
    val cachedAt: Long = System.currentTimeMillis()
)
