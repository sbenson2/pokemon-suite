import SwiftUI
import SuiteCore

struct PokedexView:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var scheme
    @State private var search=""
    @State private var selection:JSONValue?
    @State private var showingDetail=false
    var filtered:[JSONValue]{model.species.filter{search.isEmpty || $0["name"].string.localizedCaseInsensitiveContains(search) || $0["id"].text==search}}
    var body:some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 720 && !typeSize.isAccessibilitySize
            HStack(spacing:0) {
                speciesList.frame(maxWidth:wide ? 320:.infinity)
                if wide {
                    Divider()
                    if let mon=selection ?? model.species.first {PokemonDetail(mon:mon).frame(maxWidth:.infinity)}
                    else {ContentUnavailableView("Select a Pokémon",systemImage:"book.closed")}
                }
            }
            .sheet(isPresented:Binding(get:{!wide && showingDetail},set:{if !wide{showingDetail=$0}})) {
                if let mon=selection {NavigationStack{PokemonDetail(mon:mon).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){showingDetail=false}}}}}
            }
        }
        .onChange(of:model.selectedGame){_,_ in selection=nil;showingDetail=false}
    }
    private var speciesList:some View {
        VStack(spacing:4){
            GameSearchField("Search Pokémon",text:$search).padding(.horizontal,8)
            if model.species.isEmpty{ContentUnavailableView("Pokédex unavailable",systemImage:"book.closed",description:Text("Choose FireRed, LeafGreen, Emerald or Crystal."))}
            else{List(filtered,id:\.gameID){mon in Button{model.selectedSpecies=mon["id"].int;selection=mon;showingDetail=true}label:{HStack(spacing:14){ROMSprite(id:mon["id"].int,size:42);VStack(alignment:.leading,spacing:4){Text(mon["name"].string).font(.headline).foregroundStyle(.primary);Text(mon["types"].array.map{$0.string.capitalized}.joined(separator:" / ")).font(.caption).foregroundStyle(.secondary)};Spacer();Text(String(format:"%03d",mon["id"].int)).font(.caption.monospacedDigit()).foregroundStyle(.secondary);Image(systemName:"chevron.right").font(.caption).foregroundStyle(.tertiary)}}.listRowBackground(GamePalette(dark:scheme == .dark).panel)}.scrollContentBackground(.hidden).listStyle(.plain).overlay{Rectangle().stroke(Color(uiColor:.separator),lineWidth:0.5).allowsHitTesting(false)}}
        }
    }
}
struct PokemonDetail:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.dismiss) private var dismiss
    let mon:JSONValue
    @State private var section="Overview"
    @State private var shiny=false
    var body:some View{
        VStack(spacing:0){
            HStack(spacing:20){ROMSprite(id:mon["id"].int,shiny:shiny,size:84);VStack(alignment:.leading,spacing:8){Text(mon["name"].string).font(.title2.weight(.semibold));Text(mon["types"].array.map{$0.string.capitalized}.joined(separator:" / ")).foregroundStyle(.secondary);Toggle("Shiny",isOn:$shiny).toggleStyle(.button)};Spacer()}.padding(16)
            SectionTabs(label:"Pokédex details",items:["Overview","Locations","Moves"],selection:$section)
            BorderedScroll{VStack(alignment:.leading,spacing:16){
                if section=="Overview"{
                    Text("Base stats").font(.headline)
                    ForEach(["hp","attack","defense","specialAttack","specialDefense","speed"],id:\.self){stat in HStack{Text(statName(stat)).frame(width:80,alignment:.leading);ProgressView(value:Double(mon["stats"][stat].int),total:255).accessibilityLabel(statName(stat));Text(mon["stats"][stat].text).monospacedDigit().frame(width:30)}}
                    Divider();LabeledContent("Abilities",value:mon["abilities"].array.map(\.label).joined(separator:", "));LabeledContent("Catch rate",value:mon["catchRate"].text);LabeledContent("Egg groups",value:mon["eggGroups"].array.map(\.text).joined(separator:", "))
                }else if section=="Locations"{
                    if mon["encounters"].array.isEmpty{Text("No wild encounters. Preview a hunt for other routes.").foregroundStyle(.secondary)}
                    ForEach(Array(mon["encounters"].array.enumerated()),id:\.offset){_,entry in VStack(alignment:.leading,spacing:6){Text(entry["location"].string).font(.headline);Text(entry["method"].string).font(.callout).foregroundStyle(.secondary);HStack{Text("Lv. \(entry["minLevel"].text)–\(entry["maxLevel"].text)");Spacer();Text("\(entry["chance"].text)%")}.font(.caption);Divider()}}
                }else{ForEach(Array(mon["learnset"].array.enumerated()),id:\.offset){_,entry in let move=model.dex["moves"].array.first{$0["id"].int==entry["moveId"].int} ?? .null;HStack{Text(move.label);Spacer();Text(entry["method"].string=="level-up" ? "Level \(entry["level"].text)":entry["method"].string).foregroundStyle(.secondary)};Divider()}}
            }}
            Button("Set Up Hunt"){model.selectedSpecies=mon["id"].int;model.page = .farming;dismiss()}.buttonStyle(.borderedProminent).padding(12)
        }.navigationTitle("Pokédex").navigationBarTitleDisplayMode(.inline)
    }
}
