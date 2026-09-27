import XCTest
@testable import SuiteCore

final class FieldPreviewTests:XCTestCase {
    func testOnlyConsecutiveFreshFieldObservationsPermitCapture() throws {
        func snapshot(_ mode:String="overworld",map:String="MAP_ROUTE24",frame:Int=100)->JSONValue {
            // Native telemetry identifies maps in observation, not spectator.
            .object(["game":.string("firered"),"sessionId":.string("session-a"),"mode":.string(mode),"frame":.number(Double(frame)),"updatedAt":.string("2026-09-14T02:00:00Z"),"observation":.object(["phase":.string("stable"),"map":.object(["id":.string(map)])]),"spectator":.object(["map":.object(["name":.string("Route 24")])])])
        }
        let now=Date(timeIntervalSince1970:1789351201)
        var gate=FieldPreviewGate()
        XCTAssertFalse(gate.observe(snapshot(),now:now,connected:true))
        XCTAssertTrue(gate.observe(snapshot(frame:200),now:now,connected:true))
        XCTAssertFalse(gate.observe(snapshot("battle",frame:300),now:now,connected:true))
        XCTAssertFalse(gate.observe(snapshot(map:"MAP_ROUTE25",frame:400),now:now,connected:true))
        XCTAssertTrue(gate.observe(snapshot(map:"MAP_ROUTE25",frame:500),now:now,connected:true))
        XCTAssertFalse(gate.observe(snapshot(map:"MAP_ROUTE25",frame:600),now:now.addingTimeInterval(30),connected:true))
        XCTAssertFalse(gate.observe(snapshot(frame:700),now:now,connected:false))
    }
}
