package dev.nexustitan.fieldrelay.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutboxItem(item: OutboxItem)

    @Update
    suspend fun updateOutboxItem(item: OutboxItem)

    @Query("SELECT * FROM offline_outbox WHERE status = 'approved_for_sync' ORDER BY createdAt ASC")
    suspend fun getPendingSyncItems(): List<OutboxItem>

    @Query("SELECT * FROM offline_outbox ORDER BY createdAt DESC")
    fun getAllOutboxItemsFlow(): Flow<List<OutboxItem>>

    @Query("UPDATE offline_outbox SET status = 'synced', syncedAt = :timestamp WHERE id = :id")
    suspend fun markAsSynced(id: String, timestamp: Long)

    @Query("UPDATE offline_outbox SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)

    @Query("SELECT COUNT(*) FROM offline_outbox WHERE status = 'approved_for_sync'")
    fun getPendingCountFlow(): Flow<Int>
}

@Dao
interface AssetDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAssets(assets: List<CachedAsset>)

    @Query("SELECT * FROM cached_assets WHERE qrMarkerId = :markerId OR assetId = :markerId LIMIT 1")
    suspend fun findByMarkerOrId(markerId: String): CachedAsset?

    @Query("SELECT * FROM cached_assets ORDER BY assetId ASC")
    suspend fun getAllAssets(): List<CachedAsset>
}
