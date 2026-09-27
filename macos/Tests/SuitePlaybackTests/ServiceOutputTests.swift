import XCTest
@testable import PokemonSuiteMac

final class ServiceOutputTests: XCTestCase {
    func testServiceExitDetachesPipeMonitorInsteadOfQueuingEmptyReads() throws {
        let pipe = Pipe(), input = pipe.fileHandleForReading, output = pipe.fileHandleForWriting
        defer { input.readabilityHandler = nil; try? input.close() }
        try output.write(contentsOf: Data("startup failed\n".utf8))
        XCTAssertEqual(readServiceOutput(from: input), Data("startup failed\n".utf8))
        try output.close()
        input.readabilityHandler = { _ in }
        XCTAssertNil(readServiceOutput(from: input))
        XCTAssertNil(input.readabilityHandler)
    }
}
