package dev.nexustitan.fieldrelay.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dev.nexustitan.fieldrelay.FieldRelayApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Background sync worker for approved offline outbox records.
 *
 * ENGINEERING CONSTRAINT:
 * Strictly flushes approved transactional outbox events to the server.
 * Never executes background local AI model inference.
 */
class FieldSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val app = applicationContext as FieldRelayApp
        val outboxDao = app.database.outboxDao()
        val vault = app.vault

        val pending = outboxDao.getPendingSyncItems()
        if (pending.isEmpty()) {
            return@withContext Result.success()
        }

        try {
            for (item in pending) {
                // Decrypt local outbox item payload using hardware Keystore
                val decryptedJson = String(vault.decrypt(item.encryptedPayload), Charsets.UTF_8)

                // Transmit to FastAPI sync endpoint
                val requestBody = decryptedJson.toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("${dev.nexustitan.fieldrelay.BuildConfig.API_BASE_URL}/sync/events")
                    .post(requestBody)
                    .addHeader("X-Titan-Client-Device", item.id)
                    .build()

                val response = httpClient.newCall(request).execute()
                if (response.isSuccessful) {
                    outboxDao.markAsSynced(item.id, System.currentTimeMillis())
                } else if (response.code in 400..499) {
                    // Fail closed on permanent policy rejection
                    outboxDao.updateStatus(item.id, "rejected")
                } else {
                    // Retryable network/server error
                    return@withContext Result.retry()
                }
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
