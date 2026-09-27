// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PokemonSuiteMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "PokemonSuite", targets: ["PokemonSuiteMac"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.6")],
    targets: [
        .target(name: "SuiteCore"),
        .executableTarget(name: "PokemonSuiteMac", dependencies: ["SuiteCore", .product(name: "Sparkle", package: "Sparkle")],
                          linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .testTarget(name: "SuiteCoreTests", dependencies: ["SuiteCore"]),
        .testTarget(name: "SuitePlaybackTests", dependencies: ["SuiteCore", "PokemonSuiteMac"])
    ],
    swiftLanguageModes: [.v5]
)
