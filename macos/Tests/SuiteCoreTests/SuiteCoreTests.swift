import XCTest
@testable import SuiteCore

final class SuiteCoreTests: XCTestCase {
    func testHeldItemsUseCartridgeIdentifiersRatherThanGlobalPokedexIdentifiers() throws {
        let items = try JSONDecoder().decode(JSONValue.self, from: Data(#"[{"id":182,"nativeId":172,"name":"Apicot Berry"},{"id":216,"nativeId":182,"name":"Exp. Share"}]"#.utf8)).array
        XCTAssertEqual(CartridgeItem.name(nativeID: 182, catalog: items), "Exp. Share")
        XCTAssertNil(CartridgeItem.name(nativeID: 216, catalog: items))
    }
    func testFragmentedStreamWaitsForCompletePixels() throws {
        var decoder = FrameDecoder()
        let frame = Data([0x4d,0x52,0x46,0x31,0,2,0,1,0,0,0,8,0,0,0,1,255,0,0,255,0,255,0,255])
        XCTAssertNil(try decoder.append(frame.prefix(11)))
        XCTAssertNil(try decoder.append(frame.subdata(in: 11..<20)))
        let result = try XCTUnwrap(decoder.append(frame.suffix(4)))
        XCTAssertEqual(result.width, 2)
        XCTAssertEqual(result.height, 1)
        XCTAssertEqual(result.pixels, Data([255,0,0,255,0,255,0,255]))
    }

    func testStreamDropsSupersededFramesInsteadOfGrowingLatency() throws {
        var decoder = FrameDecoder()
        let header: [UInt8] = [0x4d,0x52,0x46,0x31,0,1,0,1,0,0,0,4,0,0,0,1]
        let frames = Data(header + [1,2,3,255] + header + [4,5,6,255])
        XCTAssertEqual(try decoder.append(frames)?.pixels, Data([4,5,6,255]))
    }

    func testFrameStreamKeepsPartialNextFrameAcrossNetworkChunks() throws {
        var decoder = FrameDecoder()
        let header: [UInt8] = [0x4d,0x52,0x46,0x31,0,1,0,1,0,0,0,4,0,0,0,1]
        let first = Data(header + [1,2,3,255])
        let second = Data(header + [9,8,7,255])
        XCTAssertEqual(try decoder.append(first + second.prefix(18))?.pixels, Data([1,2,3,255]))
        XCTAssertEqual(try decoder.append(second.suffix(2))?.pixels, Data([9,8,7,255]))
        XCTAssertEqual(try decoder.append(first)?.pixels, Data([1,2,3,255]))
    }

    func testInvalidFrameLengthCannotAllocateUnboundedMemory() {
        var decoder = FrameDecoder()
        let invalid = Data([0x4d,0x52,0x46,0x31,0,1,0,1,255,255,255,255,0,0,0,0])
        XCTAssertThrowsError(try decoder.append(invalid))
    }

    func testKeyboardHoldsTwoDirectionsAndReleasesOnFocusLoss() {
        var input = GameKeyboard()
        XCTAssertEqual(input.update(keyCode: 126, pressed: true), ["up"])
        XCTAssertEqual(Set(input.update(keyCode: 123, pressed: true)!), ["up","left"])
        XCTAssertEqual(input.update(keyCode: 126, pressed: false), ["left"])
        XCTAssertEqual(input.releaseAll(), [])
        XCTAssertNil(input.update(keyCode: 99, pressed: true))
    }

    func testServiceAnnouncementRejectsRemoteURLsAndMismatchedPorts() throws {
        XCTAssertEqual(try ServiceAnnouncement(data: Data(#"{"product":"pokemon-suite","port":17890,"url":"http://127.0.0.1:17890/"}"#.utf8)).url.port, 17890)
        for address in ["https://example.com:17890/", "http://127.0.0.1:17891/", "http://user@127.0.0.1:17890/"] {
            let data = try JSONSerialization.data(withJSONObject: ["product":"pokemon-suite","port":17890,"url":address])
            XCTAssertThrowsError(try ServiceAnnouncement(data: data))
        }
    }

    func testKeyboardLeavesTabAndEscapeAvailableForLeavingTheGame() {
        var input = GameKeyboard()
        XCTAssertEqual(input.update(keyCode: 126, pressed: true), ["up"])
        XCTAssertNil(input.update(keyCode: 48, pressed: true))
        XCTAssertNil(input.update(keyCode: 53, pressed: true))
        XCTAssertEqual(input.releaseAll(), [])
        XCTAssertEqual(input.update(keyCode: 49, pressed: true), ["select"])
        XCTAssertEqual(input.update(keyCode: 49, pressed: false), [])
    }

    func testFlexibleGameDataPreservesUnknownFieldsAndBooleanTypes() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"enabled":true,"level":34,"task":{"phase":"healing"},"newField":[1,"x"]}"#.utf8))
        XCTAssertEqual(value["enabled"].bool, true)
        XCTAssertEqual(value["level"].int, 34)
        XCTAssertEqual(value["task"]["phase"].string, "healing")
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value)), value)
    }
}
