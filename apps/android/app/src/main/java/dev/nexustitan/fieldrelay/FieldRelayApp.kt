package dev.nexustitan.fieldrelay

import android.app.Application
import dev.nexustitan.fieldrelay.data.AndroidKeystoreVault
import dev.nexustitan.fieldrelay.data.FieldRelayDatabase

/**
 * NEXUS TITAN Android FieldRelay Application.
 * Initializes the hardware Keystore vault and encrypted Room offline database.
 */
class FieldRelayApp : Application() {

    lateinit var vault: AndroidKeystoreVault
        private set

    lateinit var database: FieldRelayDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize Android Keystore AES-256-GCM vault
        vault = AndroidKeystoreVault(this)

        // Initialize Room offline outbox database
        database = FieldRelayDatabase.getInstance(this)
    }

    companion object {
        lateinit var instance: FieldRelayApp
            private set
    }
}
