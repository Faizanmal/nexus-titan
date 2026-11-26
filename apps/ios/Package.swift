// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FieldRelay",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(name: "FieldRelayCore", targets: ["FieldRelayCore"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/firebase/firebase-ios-sdk.git",
            exact: "11.8.0"
        ),
        .package(path: "../../bindings/swift")
    ],
    targets: [
        .target(
            name: "FieldRelayCore",
            dependencies: [
                .product(name: "FirebaseVertexAI", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAppCheck", package: "firebase-ios-sdk"),
                .product(name: "NexusTitanContracts", package: "swift")
            ],
            path: "FieldRelay/Sources"
        ),
        .testTarget(
            name: "FieldRelayTests",
            dependencies: [
                "FieldRelayCore",
                .product(name: "NexusTitanContracts", package: "swift")
            ],
            path: "FieldRelay/Tests/FieldRelayTests"
        )
    ]
)
