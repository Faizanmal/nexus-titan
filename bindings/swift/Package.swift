// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NexusTitanContracts",
    products: [.library(name: "NexusTitanContracts", targets: ["NexusTitanContracts"])],
    targets: [
        .target(name: "NexusTitanContracts"),
        .testTarget(name: "NexusTitanContractsTests", dependencies: ["NexusTitanContracts"]),
    ]
)
