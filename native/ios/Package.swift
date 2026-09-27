// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "SuiteMobileCore", platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "SuiteMobileCore", targets: ["SuiteMobileCore"])],
    targets: [.target(name: "SuiteMobileCore", path: "Core"),
              .testTarget(name: "SuiteMobileCoreTests", dependencies: ["SuiteMobileCore"], path: "Tests")],
    swiftLanguageModes: [.v5])
