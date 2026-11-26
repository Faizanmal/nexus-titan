# ProGuard rules for NEXUS TITAN Android FieldRelay Node
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep Room entities and DAOs
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# Keep kotlinx.serialization models
-keepattributes *Annotation*,InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class * {
    *** Companion;
}
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer();
}

# Keep MLKit Barcode models
-keep class com.google.mlkit.vision.barcode.** { *; }

# Keep Keystore vault crypto
-keep class androidx.security.crypto.** { *; }
