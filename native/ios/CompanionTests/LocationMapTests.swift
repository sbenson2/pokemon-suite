import XCTest
import SuiteCore
@testable import PokemonSuiteCompanion

final class LocationMapTests: XCTestCase {
    func testMapUsesAuthoritativeRegionalCellAndObservedFemaleCharacter() throws {
        let s=try session()
        let p=LocationMapSnapshot(session:s,game:"firered",connected:true,now:now)
        XCTAssertEqual(p.map?.region,"kanto")
        XCTAssertEqual(p.map?.x,4);XCTAssertEqual(p.map?.y,13)
        XCTAssertEqual(p.head,"female")
        XCTAssertEqual(p.position,"4, 7")
        XCTAssertFalse(p.lastKnown)
    }
    func testUnknownInvalidAndOtherGameMapDataNeverInventsAPin() throws {
        for map in ["null",#"{"region":"kanto","x":-1,"y":0}"#,#"{"region":"kanto","x":1.5,"y":0}"#,#"{"region":"kanto","x":22,"y":0}"#,#"{"region":"unknown","x":1,"y":1}"#] {
            XCTAssertNil(LocationMapSnapshot(session:try session(map:map),game:"firered",connected:true,now:now).map)
        }
        XCTAssertNil(LocationMapSnapshot(session:try session(),game:"emerald",connected:true,now:now).map)
        XCTAssertNil(LocationMapSnapshot(session:try session(gender:"null"),game:"firered",connected:true,now:now).head)
    }
    func testBattleLocationPersistsButConnectionAndFreshnessAreHonest() throws {
        let s=try session()
        XCTAssertNotNil(LocationMapSnapshot(session:s,game:"firered",connected:true,now:now).map)
        XCTAssertTrue(LocationMapSnapshot(session:s,game:"firered",connected:false,now:now).lastKnown)
        XCTAssertTrue(LocationMapSnapshot(session:s,game:"firered",connected:true,now:now.addingTimeInterval(60)).lastKnown)
    }
    private var now:Date {ISO8601DateFormatter().date(from:"2026-09-16T05:00:02Z")!}
    private func session(map:String = #"{"region":"kanto","x":4,"y":13}"#,gender:String = #""GIRL""#) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self,from:Data("""
        {"game":"firered","sessionId":"a","state":"running","mode":"battle","updatedAt":"2026-09-16T05:00:00Z","observation":{"map":{"id":"MAP_ROUTE21_SOUTH"},"position":{"x":4,"y":7}},"spectator":{"map":{"name":"Route 21 South","townMap":\(map)},"trainer":{"gender":\(gender)}}}
        """.utf8))
    }
}
