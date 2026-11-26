package dev.nexustitan.fieldrelay.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [OutboxItem::class, CachedAsset::class],
    version = 1,
    exportSchema = false
)
abstract class FieldRelayDatabase : RoomDatabase() {

    abstract fun outboxDao(): OutboxDao
    abstract fun assetDao(): AssetDao

    companion object {
        @Volatile
        private var INSTANCE: FieldRelayDatabase? = null

        fun getInstance(context: Context): FieldRelayDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    FieldRelayDatabase::class.java,
                    "nexus_titan_fieldrelay.db"
                ).fallbackToDestructiveMigration().build()
                INSTANCE = instance
                instance
            }
        }
    }
}
