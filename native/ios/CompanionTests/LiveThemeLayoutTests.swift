import XCTest
import SwiftUI
import SuiteCore
@testable import PokemonSuiteCompanion

@MainActor final class LiveThemeLayoutTests:XCTestCase {
    // Synthetic telemetry; no ROM graphics, network connection or game commands.
    private func model() throws -> SuiteModel {
        let model=SuiteModel()
        model.state=try JSONDecoder().decode(JSONValue.self,from:Data(#"{"library":[{"id":"firered","title":"Pokémon FireRed","platform":"gba","status":"installed"}],"sessions":[{"game":"firered","sessionId":"layout","state":"running","spectator":{"trainer":{"name":"RED","money":19632,"pokedex":{"owned":13}},"map":{"name":"Route 24"},"badges":[{"label":"Boulder Badge","earned":true},{"label":"Cascade Badge","earned":true}],"party":[{"speciesId":1,"speciesName":"Bulbasaur","level":7,"hp":0,"maxHp":24,"status":"FNT"},{"speciesId":29,"speciesName":"Nidoran♀","level":12,"hp":10,"maxHp":38,"status":"PSN"},{"speciesId":122,"speciesName":"Mr. Mime","level":18,"hp":42,"maxHp":42},{"speciesId":131,"speciesName":"Lapras","level":25,"hp":80,"maxHp":100},{"speciesId":102,"speciesName":"Exeggcute","level":15,"hp":40,"maxHp":50},{"speciesId":9,"speciesName":"Blastoise","level":36,"hp":108,"maxHp":108,"experience":{"ratio":0.5,"remaining":1200}}]}}]}"#.utf8))
        model.connected=true
        return model
    }
    func testPartyFitsNarrowWidthsAndExpandsForAccessibility() throws {
        let m=try model()
        func height(_ width:CGFloat,_ type:DynamicTypeSize)->CGFloat {
            let host=UIHostingController(rootView:PartyPanel().environmentObject(m).environment(\.dynamicTypeSize,type))
            let fit=host.sizeThatFits(in:CGSize(width:width,height:10000))
            XCTAssertLessThanOrEqual(fit.width,width+1)
            XCTAssertGreaterThan(fit.height,200)
            return fit.height
        }
        XCTAssertGreaterThan(height(320,.accessibility3),height(320,.large))
        XCTAssertLessThan(height(700,.large),height(320,.large))
    }
    func testSixCompactSlotsFitTheReferenceTeamColumn() throws {
        let host=UIHostingController(rootView:PartyPanel(compact:true).environmentObject(try model()).environment(\.dynamicTypeSize,.large))
        let fit=host.sizeThatFits(in:CGSize(width:226,height:1000))
        XCTAssertLessThanOrEqual(fit.width,226)
        XCTAssertLessThanOrEqual(fit.height,244,"Three party rows must fit beside Session")
        XCTAssertGreaterThan(fit.height,180)
    }
    func testLiveLayoutLightDarkAndLargeText() throws {
        let m=try model()
        for (width,height,type) in [(CGFloat(320),CGFloat(650),DynamicTypeSize.large),(390,710,.large),(390,710,.accessibility3),(1000,760,.large)] {
            for scheme in [ColorScheme.light,.dark] {
                let view=VStack(spacing:4){SuiteHeader();LiveView(playback:m.playback)}.environmentObject(m).environment(\.dynamicTypeSize,type).environment(\.colorScheme,scheme)
                let host=UIHostingController(rootView:view)
                let window=UIWindow(frame:CGRect(x:0,y:0,width:width,height:height))
                window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds;host.view.layoutIfNeeded()
                let fit=host.sizeThatFits(in:window.bounds.size)
                XCTAssertLessThanOrEqual(fit.width,width+1);XCTAssertLessThanOrEqual(fit.height,height+1)
                let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in host.view.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
                let attachment=XCTAttachment(image:image);attachment.name="Live-\(Int(width))-\(scheme)-\(type)";attachment.lifetime = .keepAlways;add(attachment)
                window.isHidden=true
            }
        }
    }
    func testSessionStatesFitCompactAndAccessibilityLayouts() throws {
        let states = ["working", "waiting", "recovering", "review", "route", "disconnected"]
        for state in states {
            let m=try model()
            var s=m.session
            s["updatedAt"] = .string(ISO8601DateFormatter().string(from:Date()))
            s["bot"] = try JSONDecoder().decode(JSONValue.self,from:Data(#"{"enabled":true,"status":"running","runScope":"postgame","objective":{"identityEvolution":true,"coreSpecies":[48],"target":{"kind":"map"}},"preparation":{"kind":"postgame","phase":"national-dex","progress":{"level":26,"required":31}}}"#.utf8))
            s["postgame"] = try JSONDecoder().decode(JSONValue.self,from:Data(#"{"workflows":{"dex":{"target":{"speciesId":49,"method":"evolution"}}},"collection":[{"speciesId":49,"name":"venomoth","fromSpecies":48}]}"#.utf8))
            s["spectator"]["party"] = try JSONDecoder().decode(JSONValue.self,from:Data(#"[{"speciesId":48,"speciesName":"Venonat"}]"#.utf8))
            s["decision"]["kind"] = .string("act")
            s["decision"]["recommendation"]["kind"] = .string("move-toward")
            if state == "waiting" { s["decision"]["kind"] = .string("resample");s["decision"]["reason"] = .string("Waiting for the evolution observation.") }
            if state == "recovering" { s["bot"]["status"] = .string("recovering");s["bot"]["progress"]["status"] = .string("retry");s["bot"]["reason"] = .string("Rechecking the route after a blocked step.") }
            if state == "review" { s["bot"]["status"] = .string("blocked");s["bot"]["reason"] = .string("No progress after the recovery budget. The current save is preserved.") }
            if state == "route" { s["decision"]["recommendation"]["kind"] = .string("wait-for-supported-objective") }
            m.state["sessions"] = .array([s]);m.connected = state != "disconnected"
            for accessible in [false,true] {
                let width:CGFloat=accessible ? 320 : 154
                let height:CGFloat=accessible ? 760 : 244
                let view=LiveSessionPanel(compact:!accessible).environmentObject(m)
                    .environment(\.dynamicTypeSize,accessible ? .accessibility3 : .large)
                    .environment(\.colorScheme,accessible ? .dark : .light)
                let host=UIHostingController(rootView:view)
                // The card lives inside an already inset dashboard. An isolated
                // hosting window must not add the phone's safe area a second time.
                host.safeAreaRegions=[]
                let window=UIWindow(frame:CGRect(x:0,y:0,width:width,height:height))
                window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds;host.view.layoutIfNeeded()
                let fit=host.sizeThatFits(in:window.bounds.size)
                XCTAssertLessThanOrEqual(fit.width,width+1,"\(state) must stay inside the Session column")
                XCTAssertLessThanOrEqual(fit.height,height+1,"\(state) must keep a bounded details scroller")
                let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in host.view.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
                let attachment=XCTAttachment(image:image);attachment.name="Session-\(state)-\(accessible ? "accessible" : "compact")";attachment.lifetime = .keepAlways;add(attachment)
                window.isHidden=true
            }
        }
    }
}
