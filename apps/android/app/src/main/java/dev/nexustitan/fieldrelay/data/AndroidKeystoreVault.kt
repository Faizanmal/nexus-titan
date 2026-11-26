package dev.nexustitan.fieldrelay.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware-backed AES-256-GCM vault powered by Android Keystore.
 * Protects local offline data, device private keys, and session tokens.
 */
class AndroidKeystoreVault(private val context: Context) {

    private val keyStore: KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply {
        load(null)
    }

    init {
        ensureMasterKey()
    }

    private fun ensureMasterKey() {
        if (!keyStore.containsAlias(MASTER_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                KEYSTORE_PROVIDER
            )
            val spec = KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
            keyGenerator.init(spec)
            keyGenerator.generateKey()
        }
    }

    private fun getSecretKey(): SecretKey {
        return (keyStore.getEntry(MASTER_KEY_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
    }

    /**
     * Encrypts plaintext bytes using AES-GCM-256.
     * Returns Base64-encoded string containing 12-byte IV prepended to ciphertext.
     */
    fun encrypt(data: ByteArray): String {
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getSecretKey())
        val iv = cipher.iv // 12-byte standard GCM IV
        val cipherText = cipher.doFinal(data)

        val combined = ByteArray(iv.size + cipherText.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(cipherText, 0, combined, iv.size, cipherText.size)

        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    /**
     * Decrypts Base64-encoded IV+ciphertext string back to plaintext bytes.
     */
    fun decrypt(base64Cipher: String): ByteArray {
        val combined = Base64.decode(base64Cipher, Base64.NO_WRAP)
        require(combined.size > GCM_IV_LENGTH_BYTES) { "Invalid encrypted payload size." }

        val iv = ByteArray(GCM_IV_LENGTH_BYTES)
        val cipherText = ByteArray(combined.size - GCM_IV_LENGTH_BYTES)

        System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH_BYTES)
        System.arraycopy(combined, GCM_IV_LENGTH_BYTES, cipherText, 0, cipherText.size)

        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        cipher.init(Cipher.DECRYPT_MODE, getSecretKey(), spec)

        return cipher.doFinal(cipherText)
    }

    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val MASTER_KEY_ALIAS = "nexus_titan_field_vault_v1"
        private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH_BYTES = 12
        private const val GCM_TAG_LENGTH_BITS = 128
    }
}
