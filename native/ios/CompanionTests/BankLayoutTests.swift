import XCTest
import SwiftUI
import SuiteCore
@testable import PokemonSuiteCompanion

/// The Bank on iPhone and iPad: the species detail, Get It and Inspect fit the screen width.
/// With BANK_REVIEW_URL (a Suite serving the Bank and ROM artwork, e.g. tools/bank_stub.py) the pages
/// are rendered with its data and artwork; BANK_REVIEW_IMAGES keeps those PNGs. The fit checks run
/// without a Suite (offline sprite placeholders), so they keep no image. Nothing here sends a game command.
@MainActor final class BankLayoutTests:XCTestCase {
    private func json(_ text:String)->JSONValue{try! JSONDecoder().decode(JSONValue.self,from:Data(text.utf8))}
    private var abra:JSONValue{json(#"{"id":63,"name":"Abra","types":["psychic"],"genderRate":2,"abilities":[{"id":28,"name":"Synchronize"},{"id":39,"name":"Inner Focus"}],"stats":{"hp":25,"attack":20,"defense":15,"specialAttack":105,"specialDefense":55,"speed":90},"encounters":[],"evolutions":[],"learnset":[]}"#)}
    private var entry:JSONValue{json(#"{"id":63,"owned":3,"shiny":1,"saves":6,"route":{"category":"wild","label":"Wild","detail":"Walking: Road 24, Road 25","obtainable":true,"hunt":true}}"#)}

    private func snapshot<V:View>(_ view:V,model:SuiteModel,size:CGSize,name:String,dark:Bool=false,wait:Int=0,regular:Bool=false,keep:Bool=true) async throws {
        // regular: an iPad-width window (the test host runs on an iPhone simulator)
        let host=UIHostingController(rootView:view.environmentObject(model).environment(\.colorScheme,dark ? .dark:.light).environment(\.horizontalSizeClass,regular ? .regular:.compact))
        let window=UIWindow(frame:CGRect(origin:.zero,size:size))
        window.overrideUserInterfaceStyle=dark ? .dark:.light
        window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
        for _ in 0..<wait{try await Task.sleep(for:.milliseconds(150));host.view.layoutIfNeeded()}
        host.view.layoutIfNeeded()
        let fit=host.sizeThatFits(in:size)
        XCTAssertLessThanOrEqual(fit.width,size.width+1,name)
        guard keep else{window.isHidden=true;return}
        let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in host.view.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
        let attachment=XCTAttachment(image:image);attachment.name=name;attachment.lifetime = .keepAlways;add(attachment)
        if let directory=ProcessInfo.processInfo.environment["BANK_REVIEW_IMAGES"]{
            try FileManager.default.createDirectory(at:URL(fileURLWithPath:directory),withIntermediateDirectories:true)
            try image.pngData()?.write(to:URL(fileURLWithPath:directory).appendingPathComponent(name+".png"))
        }
        window.isHidden=true
    }

    func testSpeciesDetailAndGetItFitAnIPhone() async throws {
        let model=SuiteModel()
        model.dex=json(#"{"game":"firered","natures":[{"id":"timid","name":"Timid","increased":"speed","decreased":"attack"}],"species":[]}"#)
        for dark in [false,true] {
            try await snapshot(NavigationStack{PokemonDetail(mon:abra,entry:entry)},model:model,size:CGSize(width:390,height:844),name:"ios-bank-detail-\(dark ? "dark":"light")",dark:dark,keep:false)
        }
        try await snapshot(NavigationStack{BankGetItView(mon:abra,route:entry["route"],flow:model.bankRequests)},model:model,size:CGSize(width:390,height:844),name:"ios-bank-get-it",keep:false)
    }

    /// The Bank with a Suite's data (tools/bank_stub.py serves it over read-only save copies).
    func testBankWithASuite() async throws {
        guard let address=ProcessInfo.processInfo.environment["BANK_REVIEW_URL"],let url=URL(string:address) else{throw XCTSkip("Set BANK_REVIEW_URL to render the Bank with a Suite's data.")}
        let model=SuiteModel()
        let api=SuiteAPI(baseURL:url,bearerToken:String(repeating:"0",count:64))
        model.api=api;model.state=try await api.get("/api/state");model.connected=true;model.selectedGame="firered"
        model.dex=try await api.get("/data/pokedex/firered.json");model.selectedSpecies=63;model.page = .pokedex
        let bank=try await api.get("/api/pokemon-suite/bank?game=firered")
        let abra=model.species.first{$0["id"].int==63} ?? .null
        let entry=bank["species"].array.first{$0["id"].int==63} ?? .null
        for dark in [false,true] {
            try await snapshot(GamePanel(title:"Bank",symbol:"book.closed",contentPadding:4){PokedexView()}.padding(8),model:model,size:CGSize(width:390,height:760),name:"ios-bank-list-\(dark ? "dark":"light")",dark:dark,wait:25)
        }
        try await snapshot(GamePanel(title:"Bank",symbol:"book.closed",contentPadding:4){PokedexView()}.padding(8),model:model,size:CGSize(width:1180,height:820),name:"ipad-bank-split",wait:30,regular:true)
        for dark in [false,true] {
            try await snapshot(NavigationStack{PokemonDetail(mon:abra,entry:entry)},model:model,size:CGSize(width:390,height:844),name:"ios-bank-abra-\(dark ? "dark":"light")",dark:dark,wait:25)
        }
        var settings=BankDraft(speciesId:63);settings.shiny=true;settings.natures=["timid"];settings.destination="switch"
        await model.bankRequests.select(settings.selection)
        try await snapshot(NavigationStack{BankGetItView(mon:abra,route:entry["route"],flow:model.bankRequests,settings:settings).navigationTitle("Get Abra").navigationBarTitleDisplayMode(.inline)},
                           model:model,size:CGSize(width:390,height:1700),name:"ios-bank-get-it-abra",wait:10)
        let owned=try await api.get("/api/pokemon-suite/bank?game=firered&species=63")
        if let first=BankIndex.individuals(owned).first {
            try await snapshot(NavigationStack{OwnedPokemonDetail(mon:first,inventory:.object(["sourceId":first["sourceId"]]),activeTrade:false,actionTitle:"Send to Switch"){}},model:model,size:CGSize(width:390,height:844),name:"ios-bank-inspect",wait:10)
        }
    }
}
