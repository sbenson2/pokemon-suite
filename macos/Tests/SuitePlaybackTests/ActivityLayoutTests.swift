import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

final class ActivityLayoutTests: XCTestCase {
    @MainActor func testTrainingSummaryFitsTheLivePanelWithItsGoalAndLevelRequirement() throws {
        let data=Data(#"{"sessionId":"fixture","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"battle","bot":{"enabled":true},"campaign":{"task":{"kind":"training","minimumLevel":28,"targetLevel":44},"storyProgress":{"current":{"id":"master-native-103-evolve-train","label":"Master Native 103 Evolve Train"}}},"spectator":{"map":{"name":"Route 24"},"strategy":{"training":{"pokemon":{"name":"Exeggcute","level":27,"experienceRemaining":1614},"nextLevel":28,"targetLevel":44}}}}"#.utf8)
        let p=ActivityPresentation(session:try JSONDecoder().decode(JSONValue.self,from:data),now:Date(timeIntervalSince1970:1002))
        let renderer=ImageRenderer(content:ActivityContent(presentation:p).padding(16).frame(width:340).background(Color(nsColor:.windowBackgroundColor)))
        renderer.scale=2
        let image=try XCTUnwrap(renderer.cgImage)
        XCTAssertLessThanOrEqual(image.height,900)
        if let directory=ProcessInfo.processInfo.environment["ACTIVITY_REVIEW_IMAGES"] {
            try FileManager.default.createDirectory(at:URL(fileURLWithPath:directory),withIntermediateDirectories:true)
            let bitmap=NSBitmapImageRep(cgImage:image)
            try bitmap.representation(using:.png,properties:[:])?.write(to:URL(fileURLWithPath:directory).appendingPathComponent("activity-training.png"))
        }
    }
    @MainActor func testActivitySummaryFitsNarrowLivePanelInBothAppearances() throws {
        let data = Data(#"{"sessionId":"fixture","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","bot":{"enabled":true},"campaign":{"task":{"kind":"recovery","objective":{"target":{"map":"MAP_ROUTE10_POKEMON_CENTER_1F"}}},"storyProgress":{"current":{"label":"Defeat Lt. Surge"}}},"spectator":{"map":{"name":"Rock Tunnel"},"party":[{"speciesName":"Beedrill","hp":0,"maxHp":77}]}}"#.utf8)
        let session = try JSONDecoder().decode(JSONValue.self, from:data)
        let p = ActivityPresentation(session:session,now:Date(timeIntervalSince1970:1002))
        for width in [340.0,390.0] { for dark in [false,true] {
            let content = ActivityContent(presentation:p).padding(16).frame(width:width)
                .background(Color(nsColor:.windowBackgroundColor)).environment(\.colorScheme,dark ? .dark : .light)
            let renderer = ImageRenderer(content:content); renderer.scale=2
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width,Int(width * 2))
            XCTAssertLessThanOrEqual(image.height,900,"The essential Activity information must fit in 450 points without truncating it.")
            if let directory = ProcessInfo.processInfo.environment["ACTIVITY_REVIEW_IMAGES"] {
                let url = URL(fileURLWithPath:directory,isDirectory:true)
                try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
                let bitmap=NSBitmapImageRep(cgImage:image)
                try bitmap.representation(using:.png,properties:[:])?.write(to:url.appendingPathComponent("activity-\(Int(width))-\(dark ? "dark" : "light").png"))
            }
        } }
    }
    @MainActor func testPostgameOutlineFitsTheLivePanelWidthWithItsPlanAndChecklist() throws {
        let data = Data(#"{"sessionId":"fixture","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"battle","map":"MAP_ROUTE24","bot":{"enabled":true,"status":"recovering","runScope":"postgame","activity":"postgame","objective":{"id":"evolution-dex-7-9-232-train","identityEvolution":true,"coreSpecies":[231],"target":{"kind":"map","map":"MAP_ROUTE24"}},"preparation":{"kind":"postgame","phase":"national-dex","requestId":"dex-7-9-232","progress":{"level":11,"required":25}},"progress":{"status":"temporarily-blocked"}},"decision":{"kind":"resample","reason":"hunt-battle-transition"},"postgame":{"active":"national-collection","entries":[{"id":"league","label":"Enter the Hall of Fame","status":"complete"},{"id":"lorelei-visit","label":"Visit Lorelei after the Rocket Warehouse","status":"pending","executable":false,"reason":"Her optional house conversation was missed on this save."},{"id":"national-collection","label":"Complete the National Pokédex","status":"pending","executable":true},{"id":"unown-forms","label":"Collect all 28 Unown forms","status":"pending","executable":true},{"id":"fame-checker","label":"Complete the Fame Checker","status":"pending","executable":true}],"workflows":{"dex":{"target":{"speciesId":232,"method":"evolution"}}},"progress":{"dex":{"known":true,"caught":98,"total":386,"kanto":{"caught":90,"total":150},"diploma":{"caught":98,"total":380}},"species":[{"speciesId":232,"fromSpecies":231,"requirements":{"trigger":"level-up","level":25}}]}},"spectator":{"map":{"name":"Route 24"},"party":[{"speciesId":231,"speciesName":"Phanpy","level":11,"experience":{"remaining":190}}]}}"#.utf8)
        let catalog = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"species":[{"id":231,"name":"Phanpy"},{"id":232,"name":"Donphan"}]}"#.utf8))
        let p = ActivityPresentation(session:try JSONDecoder().decode(JSONValue.self,from:data),catalog:catalog,now:Date(timeIntervalSince1970:1002))
        XCTAssertNotNil(p.outline.task)
        // ROM artwork needs the running service; a placeholder keeps the layout measurable.
        let sprites = ActivitySpriteProvider { _, size in AnyView(Color.gray.frame(width:size,height:size)) }
        for width in [340.0,390.0] { for dark in [false,true] { for expanded in [false,true] {
            let content = ActivityContent(presentation:p,checklistExpanded:expanded).padding(16).frame(width:width)
                .background(Color(nsColor:.windowBackgroundColor)).environment(\.colorScheme,dark ? .dark : .light).environment(\.activitySprite,sprites)
            let renderer = ImageRenderer(content:content); renderer.scale=2
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width,Int(width * 2))
            XCTAssertLessThanOrEqual(image.height,2400,"The postgame outline stays readable in one scroll of the Live panel.")
            if let directory = ProcessInfo.processInfo.environment["ACTIVITY_REVIEW_IMAGES"] {
                let url = URL(fileURLWithPath:directory,isDirectory:true)
                try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
                try NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:])?.write(to:url.appendingPathComponent("activity-postgame-\(Int(width))-\(dark ? "dark" : "light")\(expanded ? "-checklist" : "").png"))
            }
        } } }
    }
    /// L1.1: the "Why it stopped" card with a proven-safe fix fits the Live panel in both appearances.
    @MainActor func testWhyItStoppedCardFitsTheLivePanelWithItsFix() throws {
        let data = Data(#"{"sessionId":"fixture","state":"blocked","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","map":"MAP_CELADON_CITY_POKEMON_CENTER_2F","bot":{"enabled":true,"status":"blocked","runScope":"postgame","reason":"The source Pokémon is missing, duplicated, or evolved outside the expected step."},"decision":{"kind":"blocked","reason":"The source Pokémon is missing, duplicated, or evolved outside the expected step."},"triage":{"schema":"pokemon-suite/stop-triage/v1","bucket":"known-bug-family","family":"evolution-step-source-lookup","title":"Held-item evolution route stopped at its first step","explanation":"An evolution route that starts by equipping an item looked for its source Pokémon with no species, so it stopped at the first step before anything was changed. Fixed in engine build 103; this game runs build 102.","fixedIn":103,"evidence":["Stop: The source Pokémon is missing, duplicated, or evolved outside the expected step.","Evolution step 0 (equip-evolution-item); 0 steps completed","Engine build 102"],"suggestedAction":{"action":"postgame-checklist","safe":true,"why":"Nothing was changed at the stopped step.","label":"Restart the postgame checklist","confirm":"Restarts the postgame checklist from this save. Nothing was changed at the stopped step, so the checklist picks its next objective again. The save and every Pokémon stay as they are.","playerTask":"postgame","token":"abc123"}}}"#.utf8)
        let p = ActivityPresentation(session:try JSONDecoder().decode(JSONValue.self,from:data),now:Date(timeIntervalSince1970:1002))
        XCTAssertEqual(p.triage?.suggestion.canTap, true)
        var tapped: [String] = []
        for width in [340.0,390.0] { for dark in [false,true] {
            let content = ActivityContent(presentation:p,onTriageFix:{ tapped.append($0.playerTask ?? "") }).padding(16).frame(width:width)
                .background(Color(nsColor:.windowBackgroundColor)).environment(\.colorScheme,dark ? .dark : .light)
            let renderer = ImageRenderer(content:content); renderer.scale=2
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width,Int(width * 2))
            XCTAssertLessThanOrEqual(image.height,1600,"The stop explanation and its fix stay within one scroll of the Live panel.")
            if let directory = ProcessInfo.processInfo.environment["ACTIVITY_REVIEW_IMAGES"] {
                let url = URL(fileURLWithPath:directory,isDirectory:true)
                try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
                try NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:])?.write(to:url.appendingPathComponent("activity-triage-\(Int(width))-\(dark ? "dark" : "light").png"))
            }
        } }
        XCTAssertTrue(tapped.isEmpty, "Rendering never runs the fix; only a tap does.")
    }
}
