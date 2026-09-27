#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import SuiteCore

struct GameStatisticsView: View {
    @EnvironmentObject var model: SuiteModel
    private let fields = [("Battles", "battles"), ("Trainer battles", "trainerBattles"), ("Wild battles", "wildBattles"), ("Captures", "captures"), ("Trades", "trades"), ("Heals", "heals"), ("Steps", "steps"), ("Evolutions", "evolutions")]
    var body: some View {
        let progress = model.session["spectator"]["progress"]
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 12) {
            ForEach(fields, id: \.1) { label, key in
                LabeledContent(label, value: progress[key].finiteNumber.map { Int($0).formatted() } ?? "—").font(.callout)
            }
            if let rate = model.session["campaign"]["training"]["measuredXpPerMinute"].finiteNumber {
                LabeledContent("Trainee XP per minute", value: Int(rate).formatted()).font(.callout)
                    .help("Observed XP for the assigned Pokémon, including travel, battles and healing. Paused time is excluded.")
            }
        }
    }
}

struct ShinyCollectionProgressView: View {
    @EnvironmentObject var model: SuiteModel
    var body: some View {
        let run = model.session["collectionRun"], progress = run["dexProgress"]
        if !progress.isNull {
            VStack(alignment: .leading, spacing: 12) {
                LabeledContent("Owned shiny entries", value: "\(progress["owned"].text) / \(progress["total"].text)")
                ProgressView(value: Double(progress["owned"].int), total: Double(max(1, progress["total"].int))).accessibilityLabel("Owned shiny Pokédex entries")
                HStack {
                    LabeledContent("Available", value: progress["available"].text)
                    LabeledContent("Deferred", value: progress["deferred"].text)
                }
                if let reason = run["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
                if !progress["blocked"].array.isEmpty {
                    DisclosureGroup("Unavailable entries (\(progress["blocked"].array.count))") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(progress["blocked"].array.enumerated()), id: \.offset) { _, item in
                                HStack(alignment: .top, spacing: 10) {
                                    ROMSprite(id: item["speciesId"].int, size: 32)
                                    VStack(alignment: .leading, spacing: 3) { Text(item["name"].string); Text(item["reason"].string).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }.padding(.top, 8)
                    }
                }
            }
        } else { Text("No collection progress recorded for this game.").font(.callout).foregroundStyle(.secondary) }
    }
}

struct StorageProgressView: View {
    @EnvironmentObject var model: SuiteModel
    var body: some View {
        let storage = model.session["storage"]
        if storage["known"].bool {
            VStack(alignment: .leading, spacing: 14) {
                LabeledContent("PC boxes", value: "\(storage["pcUsed"].text) / \(storage["pcCapacity"].text)")
                ProgressView(value: Double(storage["pcUsed"].int), total: Double(max(1, storage["pcCapacity"].int))).accessibilityLabel("Occupied PC slots")
                LabeledContent("Party", value: "\(storage["partyUsed"].text) / \(storage["partyCapacity"].text)")
                LabeledContent("Free spaces", value: storage["free"].text)
                LabeledContent("Reserved for shinies and transfers", value: storage["reserveSlots"].text)
                LabeledContent("Available for planned catches", value: storage["captureBudget"].text)
                if storage["shortfall"].int > 0 { Label("\(storage["shortfall"].text) more spaces needed for the full collection", systemImage: "externaldrive.badge.exclamationmark").foregroundStyle(.orange) }
                if let reason = storage["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
                Button("Open PC Inventory") { model.page = .trading }
                Text("Pokémon are never released automatically.").font(.caption).foregroundStyle(.secondary)
            }
        } else { ContentUnavailableView("Box space unavailable", systemImage: "externaldrive", description: Text("Load a supported save to read its party and boxes.")) }
    }
}

struct PostgameProgressView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var remainingOnly = true
    @State private var speciesSearch = ""
    var body: some View {
        let agenda = model.session["postgame"], progress = agenda["progress"], entries = agenda["entries"].array
        if entries.isEmpty { ContentUnavailableView("No postgame progress", systemImage: "checklist") }
        else if !progress["chapters"].array.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                let dex = progress["dex"]
                if let active = entries.first(where: { $0["id"].string == agenda["active"].string }) {
                    Text(active["label"].string).font(.title3.weight(.semibold))
                    if let reason = active["retry"]["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
                }
                LabeledContent("Postgame checkpoints", value: "\(progress["completed"].text) / \(progress["total"].text)")
                ProgressView(value: Double(progress["completed"].int), total: Double(max(1, progress["total"].int))).accessibilityLabel("Postgame checkpoints complete")
                if dex["known"].bool {
                    LabeledContent("National Pokédex", value: "\(dex["caught"].text) / 386")
                    LabeledContent("Diploma entries", value: "\(dex["diploma"]["caught"].text) / 380").foregroundStyle(.secondary)
                }
                if !progress["species"].array.isEmpty {
                    DisclosureGroup("Pokémon sources") {
                        TextField("Name or Pokédex number", text: $speciesSearch)
                            .textFieldStyle(.roundedBorder).padding(.top, 8)
                        let rows = progress["species"].array.filter { row in
                            (!remainingOnly || row["status"].string != "complete") &&
                            (speciesSearch.isEmpty || row["name"].string.localizedCaseInsensitiveContains(speciesSearch) || row["speciesId"].text == speciesSearch)
                        }
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                ForEach(rows, id: \.postgameSpeciesID) { row in
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("#\(row["speciesId"].text) \(readableGameText(row["name"].string))").fontWeight(.medium)
                                        Text(row["reason"].string).font(.callout).foregroundStyle(.secondary)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }.padding(12)
                        }.frame(maxHeight: 260)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(.secondary.opacity(0.25)))
                    }
                }
                Toggle("Remaining checkpoints", isOn: $remainingOnly).toggleStyle(.switch).controlSize(.small)
                ForEach(progress["chapters"].array, id: \.gameID) { chapter in
                    let rows = chapter["entries"].array.filter { !remainingOnly || $0["status"].string != "complete" }
                    if !rows.isEmpty {
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 14) {
                                ForEach(rows, id: \.gameID) { row in
                                    HStack(alignment: .top, spacing: 10) {
                                        Image(systemName: row["status"].string == "complete" ? "checkmark.circle.fill" : row["status"].string == "external" ? "arrow.triangle.branch" : "circle")
                                            .foregroundStyle(row["status"].string == "complete" ? Color.green : .secondary)
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(row["label"].string).fontWeight(.medium)
                                            Text(row["detail"].string).font(.callout).foregroundStyle(.secondary)
                                            if let dependency = row["dependency"].string.nonempty { Text(dependency).font(.callout).foregroundStyle(.secondary) }
                                            if row["status"].string == "unknown" { Text("Awaiting game evidence").font(.caption).foregroundStyle(.secondary) }
                                            DisclosureGroup("Completion check") { Text(row["completion"].string).font(.callout).foregroundStyle(.secondary) }.font(.caption)
                                        }
                                    }
                                }
                            }.padding(.top, 10)
                        } label: {
                            HStack { Text(chapter["label"].string); Spacer(); Text("\(chapter["entries"].array.filter { $0["status"].string == "complete" }.count) / \(chapter["entries"].array.count)").monospacedDigit().foregroundStyle(.secondary) }
                        }
                        Divider()
                    }
                }
            }
        }
        else {
            VStack(alignment: .leading, spacing: 14) {
                LabeledContent("Objectives complete", value: "\(entries.filter { $0["status"].string == "complete" }.count) / \(entries.count)")
                ForEach(entries, id: \.gameID) { entry in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: entry["status"].string == "complete" ? "checkmark.circle.fill" : "circle").foregroundStyle(entry["status"].string == "complete" ? Color.green : .secondary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry["label"].string).fontWeight(.medium)
                            Text(entry["storageBlocked"].bool ? "Waiting for PC space" : agenda["enabled"].bool && agenda["active"].string == entry["id"].string ? "In progress" : entry["conditional"].bool && entry["status"].string != "complete" ? "Conditional" : readableGameText(entry["status"].string)).font(.caption).foregroundStyle(.secondary)
                            if entry["status"].string != "complete", let reason = entry["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
                            if let retry = entry["retry"]["reason"].string.nonempty { Text(retry).font(.caption).foregroundStyle(.secondary) }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

struct StoryProgressView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var remainingOnly = false
    private var progress: JSONValue { model.session["campaign"]["storyProgress"] }
    var body: some View {
        if progress.isNull {
            ContentUnavailableView("No story run loaded", systemImage: "list.bullet.clipboard", description: Text("Story checkpoints appear here during a FireRed campaign."))
        } else {
            VStack(alignment: .leading, spacing: 16) {
                let current = progress["current"], planned = progress["planned"]
                Text(current["label"].string.nonempty ?? "Story route complete").font(.title3.weight(.semibold)).accessibilityIdentifier("storyCurrentObjective")
                if planned["id"].string != current["id"].string, !planned.isNull {
                    LabeledContent("Continuing toward", value: planned["label"].string)
                }
                LabeledContent("Now at", value: progress["location"].string)
                if !current.isNull { LabeledContent("Destination", value: current["location"].string) }
                let action = model.session["decision"]["recommendation"]
                if let kind = action["kind"].string.nonempty {
                    LabeledContent("Current action", value: readableGameText(kind))
                    if let transit = action["transit"]["destinationMap"].string.nonempty {
                        LabeledContent("Via", value: readableGameText(transit.replacingOccurrences(of: "MAP_", with: "")))
                    }
                }
                HStack {
                    Label(progress["badges"]["known"].int > 0 ? "\(progress["badges"]["earned"].text) of 8 badges verified" : "Awaiting badge evidence", systemImage: "checkmark.seal")
                    Spacer()
                    Text("\(progress["completed"].text) / \(progress["total"].text) steps").monospacedDigit().foregroundStyle(.secondary)
                }.font(.callout)
                ProgressView(value: Double(progress["completed"].int), total: Double(max(1, progress["total"].int))).accessibilityLabel("Story checkpoints complete")
                ForEach(Array(progress["issues"].array.enumerated()), id: \.offset) { _, issue in
                    Label(issue.string, systemImage: "exclamationmark.circle").foregroundStyle(.orange)
                }
                Toggle("Remaining steps only", isOn: $remainingOnly).toggleStyle(.switch).controlSize(.small)
                Divider()
                ForEach(progress["chapters"].array, id: \.gameID) { chapter in
                    if !remainingOnly || chapter["entries"].array.contains(where: { $0["status"].string != "complete" }) {
                        StoryChapterView(chapter: chapter, currentID: current["id"].string, remainingOnly: remainingOnly)
                        Divider()
                    }
                }
            }.accessibilityIdentifier("storyProgress")
        }
    }
}

private struct StoryChapterView: View {
    let chapter: JSONValue
    let currentID: String
    let remainingOnly: Bool
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 14) {
                if chapter["conditional"].bool { Text("Required if Bill’s first island trip has started.").font(.callout).foregroundStyle(.secondary) }
                ForEach(chapter["entries"].array.filter { !remainingOnly || $0["status"].string != "complete" }, id: \.gameID) { entry in
                    StoryCheckpointRow(entry: entry)
                }
            }.padding(.top, 12)
        } label: {
            HStack(alignment: .firstTextBaseline) {
                Text(chapter["label"].string).font(.headline)
                Spacer()
                Text("\(chapter["entries"].array.filter { $0["status"].string == "complete" }.count)/\(chapter["entries"].array.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
        }
        .onAppear { expanded = chapter["entries"].array.contains { $0["id"].string == currentID } }
        .onChange(of: currentID) { _, value in
            if chapter["entries"].array.contains(where: { $0["id"].string == value }) { expanded = true }
        }
    }
}

private struct StoryCheckpointRow: View {
    let entry: JSONValue
    private var status: String { entry["status"].string }
    private var symbol: String {
        switch status { case "complete": return "checkmark.circle.fill"; case "current": return "arrow.right.circle.fill"; case "needs-review": return "exclamationmark.circle"; default: return "circle" }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(status == "complete" ? Color.green : status == "current" ? .accentColor : .secondary).padding(.top, 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(entry["label"].string).fontWeight(status == "current" ? .semibold : .regular)
                Text(status == "complete" ? (entry["evidence"].string == "native" ? "Verified in game" : "Completed earlier in this run") : status == "current" ? "In progress" : status == "conditional" ? "If needed" : status == "unknown" ? "Awaiting game evidence" : status == "needs-review" ? "Needs review" : "Upcoming").font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(entry["detail"].string)
                        LabeledContent("Location", value: entry["location"].string)
                        Text("Complete when: \(entry["completion"].string)")
                        ForEach(entry["prerequisites"].array, id: \.gameID) { requirement in
                            Label(requirement["label"].string, systemImage: requirement["status"].string == "complete" ? "checkmark.circle" : "circle")
                        }
                        let battle = entry["battle"]
                        if !battle["aceLevel"].isNull {
                            LabeledContent("Opponent", value: "\(battle["opponents"].text) Pokémon · ace level \(battle["aceLevel"].text)")
                            LabeledContent("Preparation target", value: "\(battle["readyMembers"].text) members at level \(battle["targetLevel"].text)")
                        }
                    }.font(.callout).foregroundStyle(.secondary).padding(.top, 8)
                }.font(.callout)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct BotActivityView: View {
    @EnvironmentObject var model: SuiteModel
    @Binding var section: String
    @State private var progressSection = "Story"
    var body: some View {
        VStack(spacing: 0) {
            SectionTabs(label: "Bot activity", items: ["Overview", "Hunt", "Progress", "Reports"], selection: $section)
            if section == "Progress" { SectionTabs(label: "Progress details", items: ["Story", "Postgame", "Storage", "Collection"], selection: $progressSection) }
            if section == "Reports" { BotReportsView() }
            else {
                BorderedScroll {
                    if section == "Hunt" { HuntDetailView() }
                    else if section == "Progress" {
                        if progressSection == "Story" { StoryProgressView() }
                        else if progressSection == "Postgame" { PostgameProgressView() }
                        else if progressSection == "Storage" { StorageProgressView() }
                        else { ShinyCollectionProgressView() }
                    } else {
                        ActivityPanel()
                    }
                }
            }
        }
    }
}

struct BotSaveProfilesView: View {
    @EnvironmentObject var model: SuiteModel
    let profiles: [JSONValue]
    @State private var selection = ""
    @State private var name = ""
    @State private var pending: String?
    var body: some View {
        Form {
            Section("Saved games") {
                if profiles.isEmpty { Text("No saved profiles available.").foregroundStyle(.secondary) }
                else {
                    Picker("Save", selection: $selection) {
                        Text("Choose a save").tag("")
                        ForEach(profiles, id: \.gameID) { Text($0["label"].string).tag($0["id"].string) }
                    }
                    if let chosen = profiles.first(where: { $0["id"].string == selection }) { LabeledContent("Created", value: suiteDate(chosen["createdAt"].string)) }
                    Button("Restore Save…") { pending = "restore-save" }.disabled(selection.isEmpty || model.busy)
                }
            }
            Section("New manual game") {
                TextField("Save name", text: $name)
                Button("Create New Save…") { pending = "new-save" }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 50 || model.busy)
            }
        }.formStyle(.grouped).overlay { Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false) }
            .confirmationDialog(pending == "restore-save" ? "Restore this save?" : "Create a new manual save?", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
                Button(pending == "restore-save" ? "Restore Save" : "Create Save") {
                    guard let action = pending else { return }
                    let value: JSONValue = action == "restore-save" ? .object(["profileId": .string(selection)]) : .object(["label": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))])
                    model.openSaveProfile(action: action, task: value); pending = nil
                }
            } message: { Text("The current game is backed up before the selected save opens for manual play.") }
    }
}

struct BotReportsView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var report: JSONValue = .null
    @State private var issue: String?
    @State private var loading = false
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Export Report…", action: model.exportReport)
                Button("Stop & Export…") { model.exportReport(stoppingBot: true) }.disabled(!model.session["bot"]["enabled"].bool)
                Button("Copy Repair Prompt") {
                    #if os(macOS)
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(report["repairPrompt"].string, forType: .string)
                    #else
                    UIPasteboard.general.string = report["repairPrompt"].string
                    #endif
                    model.notice = "Repair prompt copied. Attach the exported report in your coding session."
                }.disabled(report["repairPrompt"].string.isEmpty)
                Spacer()
                Button { Task { await reload() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Refresh reports").disabled(loading)
            }.controlSize(.small).disabled(model.busy).padding(12)
            BorderedScroll {
                VStack(alignment: .leading, spacing: 14) {
                    if let issue { Text(issue).foregroundStyle(.secondary) }
                    if loading && report.isNull { ProgressView("Reading reports…") }
                    ForEach(report["records"].array, id: \.gameID) { record in
                        DisclosureGroup {
                            DataDetails(value: record["details"]).padding(.top, 8)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(readableGameText(record["reason"].string.nonempty ?? "Run report")).fontWeight(.medium)
                                Text(suiteDate(record["createdAt"].string)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if !loading, report["records"].array.isEmpty, issue == nil { Text("No saved failure reports. Export Report includes the current game state and decision history.").font(.callout).foregroundStyle(.secondary) }
                    ForEach(Array(report["issues"].array.enumerated()), id: \.offset) { _, issue in Text(issue.string).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }.task(id: model.selectedGame) { await reload() }
    }
    private func reload() async {
        guard let api = model.api, !loading else { return }
        let game = model.selectedGame
        loading = true; defer { loading = false }
        do {
            let value = try await api.get("/api/pokemon-suite/reports?game=\(game)")
            guard !Task.isCancelled, game == model.selectedGame else { return }
            report = value["report"]; issue = nil
        } catch { if !Task.isCancelled, game == model.selectedGame { issue = error.localizedDescription } }
    }
}

func suiteDate(_ text: String) -> String {
    let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fractional = parser.date(from: text); parser.formatOptions = [.withInternetDateTime]
    return (fractional ?? parser.date(from: text))?.formatted(date: .abbreviated, time: .shortened) ?? "Date unavailable"
}

private extension JSONValue { var postgameSpeciesID: Int { self["speciesId"].int } }
