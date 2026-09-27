import SwiftUI
import SuiteCore

struct LibraryView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var search = ""
    @State private var installedOnly = false
    @State private var details: JSONValue?
    @AppStorage("cartridgeLibraryLayout") private var layout = "grid"
    private let platforms = ["gb","gbc","gba","nds","3ds","switch"]
    private let platformNames = ["gb":"Game Boy", "gbc":"Game Boy Color", "gba":"Game Boy Advance", "nds":"Nintendo DS", "3ds":"Nintendo 3DS", "switch":"Nintendo Switch"]
    var filtered: [JSONValue] { model.games.filter { (!installedOnly || $0["status"].string != "missing") && (search.isEmpty || $0["title"].string.localizedCaseInsensitiveContains(search)) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                Toggle("In my library", isOn: $installedOnly).toggleStyle(.checkbox)
                Text("\(filtered.count) games").foregroundStyle(.secondary).monospacedDigit()
                Spacer()
                Picker("Library layout", selection: $layout) {
                    Label("Cartridges", systemImage: "square.grid.2x2").tag("grid")
                    Label("List", systemImage: "list.bullet").tag("list")
                }.pickerStyle(.segmented).labelsHidden().frame(width: 180).help("Show cartridges or a compact list")
            }.padding(.horizontal, 20).padding(.vertical, 12)
            if layout == "list" {
                List(filtered, id: \.gameID) { game in
                    HStack(spacing: 16) {
                        CartridgeView(game: game, compact: true).frame(width: 70, height: 62)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(game["title"].string).font(.headline)
                            Text(platformNames[game["platform"].string] ?? game["platform"].string).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        actions(game)
                    }.padding(.vertical, 4)
                }.listStyle(.inset).overlay(Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false))
            } else {
                BorderedScroll {
                    LazyVStack(alignment: .leading, spacing: 26) {
                        ForEach(platforms, id: \.self) { platform in
                            let games = filtered.filter { $0["platform"].string == platform }
                            if !games.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text(platformNames[platform] ?? platform).font(.title3.weight(.semibold))
                                        Spacer()
                                        Text("\(games.count)").font(.callout).foregroundStyle(.secondary)
                                    }.accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
                                    Divider()
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 215, maximum: 310), spacing: 22)], alignment: .leading, spacing: 22) {
                                        ForEach(games, id: \.gameID) { game in
                                            VStack(spacing: 6) {
                                                Button { details = game } label: {
                                                    VStack(spacing: 0) {
                                                        CartridgeView(game: game).frame(height: 176)
                                                        Text(game["title"].string).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                                                            .lineLimit(2).multilineTextAlignment(.center).frame(height: 38, alignment: .top)
                                                    }.contentShape(Rectangle())
                                                }.buttonStyle(.plain).accessibilityLabel("Details for \(game["title"].string)")
                                                HStack(spacing: 9) { actions(game) }.controlSize(.small).frame(height: 28)
                                            }.padding(.horizontal, 4).padding(.bottom, 8)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .overlay { if filtered.isEmpty { ContentUnavailableView.search(text: search) } }
        .searchable(text: $search, prompt: "Find a game")
        .toolbar {
            ToolbarItemGroup {
                Button("Open Library…", action: model.chooseProfile).help("Open an existing Suite library")
                Menu("Add Games", systemImage: "plus") {
                    Button("Choose ROM Folder…", action: model.chooseROMFolder)
                    Button("Add FireRed…", action: model.addFireRed)
                }
            }
        }
        .sheet(isPresented: Binding(get: { details != nil }, set: { if !$0 { details = nil } })) {
            if let details {
                GameDetailsSheet(game: details) { self.details = nil }
            }
        }
    }
    @ViewBuilder private func actions(_ game: JSONValue) -> some View {
        if game["status"].string == "installed" {
            let running = model.state["sessions"].array.contains { $0["game"].string == game["id"].string && !["closed","offline"].contains($0["state"].string) && !$0["sessionId"].string.isEmpty }
            Button(running ? "Stop" : "Start") {
                Task { await model.selectGame(game["id"].string); if running { model.stopGame() } else { model.startGame() } }
            }.disabled(model.busy || !running && !game["capabilities"]["play"].bool).frame(width: 65).accessibilityLabel("\(running ? "Stop" : "Start") \(game["title"].string)")
        } else {
            Text(game["status"].string == "cataloged" ? "ROM found" : "ROM required").font(.caption).foregroundStyle(.secondary)
        }
        Button("Details…") { details = game }.help("View requirements and artwork for " + game["title"].string)
    }
}

private struct GameDetailsSheet: View {
    @EnvironmentObject var model: SuiteModel
    let game: JSONValue
    let close: () -> Void
    @State private var section = "Overview"
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                CartridgeView(game: game, compact: true).frame(width: 130, height: 120)
                Text(game["title"].string).font(.title2.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(.horizontal, 20)
            SectionTabs(label: "Game details", items: ["Overview", "Capabilities", "Artwork"], selection: $section)
            BorderedScroll {
                VStack(alignment: .leading, spacing: 14) {
                    if section == "Overview" {
                        LabeledContent("Platform", value: ["gb":"Game Boy","gbc":"Game Boy Color","gba":"Game Boy Advance","nds":"Nintendo DS","3ds":"Nintendo 3DS","switch":"Nintendo Switch"][game["platform"].string] ?? game["platform"].string)
                        LabeledContent("Generation", value: game["generation"].text)
                        if let reason = game["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
                    } else if section == "Capabilities" {
                        ForEach(["play", "checkpoint", "campaign", "companion", "capture.land", "evolution", "trade", "dex"], id: \.self) { feature in
                            let value = game["features"][feature]
                            HStack {
                                LabeledContent(["play":"Play","checkpoint":"Save states","campaign":"Story bot","companion":"Companion bot","capture.land":"Wild capture","evolution":"Evolution","trade":"Trading","dex":"Pokédex"][feature] ?? feature, value: value["readiness"].text.replacingOccurrences(of: "-", with: " ").capitalized)
                                if let reason = value["reason"].string.nonempty { InfoButton(title: "Feature details", message: reason) }
                            }
                        }
                    } else { ArtworkCoverage(game: game["id"].string) }
                }
            }
            HStack { Button("Open Library…") { close(); model.chooseProfile() }; Spacer(); Button("Done", action: close).keyboardShortcut(.defaultAction) }.padding(16)
        }.frame(width: 480, height: 480)
    }
}
