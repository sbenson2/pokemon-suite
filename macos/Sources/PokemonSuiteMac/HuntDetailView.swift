import SwiftUI
import SuiteCore

struct HuntDetailView: View {
    @EnvironmentObject var model: SuiteModel
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let progress = HuntProgress(session: model.session, nowMilliseconds: context.date.timeIntervalSince1970 * 1000) {
                let mission = progress.mission, rng = mission["rng"]
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        ROMSprite(id: mission["speciesId"].int, shiny: mission["shiny"].string == "required", size: 48)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mission["name"].string.nonempty ?? "Pokémon \(mission["speciesId"].text)").font(.headline)
                            Text(progress.stale ? "Waiting for current telemetry" : readableGameText(mission["phase"].string)).font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    if let reason = mission["reason"].string.nonempty { Text(reason).font(.callout).textSelection(.enabled) }
                    if progress.protected {
                        Label("Shiny protected through capture and saving", systemImage: "checkmark.shield").font(.callout).foregroundStyle(.green)
                    }
                    HStack {
                        LabeledContent("Hunt time", value: gameDuration(progress.elapsedMilliseconds))
                        Spacer(minLength: 20)
                        LabeledContent("This stage", value: gameDuration(progress.phaseMilliseconds))
                    }.font(.callout).monospacedDigit()
                    VStack(spacing: 8) {
                        ForEach(0..<HuntProgress.stageNames.count, id: \.self) { index in
                            HStack {
                                Image(systemName: index == progress.stage ? "circle.inset.filled" : "circle").foregroundStyle(index == progress.stage ? Color.accentColor : .secondary).font(.caption)
                                Text(HuntProgress.stageNames[index])
                                Spacer(); Text(gameDuration(progress.stageMilliseconds[index])).monospacedDigit().foregroundStyle(.secondary)
                            }.font(.callout)
                        }
                    }
                    if let value = progress.inputProgress { ProgressView(value: value) { Text("Verified inputs") } currentValueLabel: { Text(value, format: .percent.precision(.fractionLength(0))) } }
                    Divider()
                    LabeledContent("Method", value: HuntProgress.methodName(rng["method"].string.nonempty ?? mission["method"].string.nonempty ?? "automatic"))
                    if let location = mission["route"].string.nonempty { LabeledContent("Location", value: readableGameText(location)) }
                    if let seconds = rng["estimatedSeconds"].finiteNumber { LabeledContent("Estimated plan time", value: gameDuration(seconds * 1000)) }
                    HStack {
                        LabeledContent("Encounters", value: mission["encounters"].text)
                        Spacer(); LabeledContent("Resets", value: mission["resets"].text)
                    }
                    LabeledContent("Caught", value: "\(mission["caught"].text) / \(mission["quantity"].text)")
                    if !rng["candidates"].array.isEmpty {
                        DisclosureGroup("Compared methods") {
                            VStack(spacing: 10) {
                                ForEach(Array(rng["candidates"].array.enumerated()), id: \.offset) { _, candidate in
                                    HStack {
                                        Text(HuntProgress.methodName(candidate["method"].string))
                                        Spacer()
                                        Text(candidate["qualified"].bool ? gameDuration(candidate["expectedSeconds"].finiteNumber.map { $0 * 1000 }) : "Not qualified").foregroundStyle(.secondary)
                                    }.font(.callout)
                                }
                            }.padding(.top, 8)
                        }
                    }
                    if !rng["traits"]["unmet"].array.isEmpty {
                        LabeledContent("Unmatched preferences", value: rng["traits"]["unmet"].array.map(\.text).joined(separator: ", "))
                    }
                    let preparation = model.session["bot"]["preparation"]
                    if preparation["kind"].string == "evolution", preparation["progress"]["required"].int > 0 {
                        LabeledContent("Evolution training", value: "Level \(preparation["progress"]["level"].text) of \(preparation["progress"]["required"].text)")
                    }
                    let collection = model.session["collectionRun"]
                    if let reason = collection["lastTransition"]["reason"].string.nonempty {
                        LabeledContent("Collection update", value: reason)
                        if let retry = collection["lastTransition"]["retryAt"].finiteNumber {
                            LabeledContent("Retry", value: retry > context.date.timeIntervalSince1970 ? "In " + gameDuration((retry - context.date.timeIntervalSince1970) * 1000) : "Queued")
                        }
                    }
                }.font(.callout)
            } else {
                ContentUnavailableView("No active hunt", systemImage: "scope", description: Text("Choose a Pokémon in Farming to plan a hunt."))
            }
        }
    }
}

struct HuntPlanView: View {
    let plan: JSONValue
    var body: some View {
        if plan.isNull { ContentUnavailableView("No hunt preview", systemImage: "map") }
        else {
            VStack(alignment: .leading, spacing: 14) {
                Label(plan["canStart"].bool ? "Ready to hunt" : plan["canStartSource"].bool ? "Acquisition available" : "Preparation required", systemImage: plan["canStart"].bool ? "checkmark.circle" : "list.bullet.clipboard").font(.headline)
                if !HuntWorkflow.canStart(plan: plan), let reason = plan["limitations"].array.first?.string.nonempty { Text(reason).foregroundStyle(.secondary) }
                if !plan["acquisition"]["source"].isNull {
                    let source = plan["acquisition"]["source"]
                    LabeledContent("Source", value: source["name"].string + " in " + (source["gameLabel"].string.nonempty ?? readableGameText(source["game"].string)))
                }
                ForEach(Array(plan["steps"].array.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 10) {
                        Text(String(index + 1)).foregroundStyle(.secondary).frame(width: 18, alignment: .trailing)
                        Text(step.string).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if !plan["readiness"].array.isEmpty {
                    Divider(); Text("Game requirements").font(.headline)
                    ForEach(Array(plan["readiness"].array.enumerated()), id: \.offset) { _, requirement in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(requirement["label"].string)
                                Spacer(); Text(readableGameText(requirement["state"].string)).foregroundStyle(.secondary)
                            }
                            if let message = requirement["message"].string.nonempty { Text(message).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
                if !plan["acquisition"]["resources"].array.isEmpty {
                    DisclosureGroup("Evolution supplies") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(plan["acquisition"]["resources"].array.enumerated()), id: \.offset) { _, resource in
                                Text("\(resource["quantity"].text) × \(resource["item"]["name"].string) — \(readableGameText(resource["game"].string))")
                                ForEach(Array(resource["item"]["sources"].array.enumerated()), id: \.offset) { _, source in
                                    Text(readableGameText(source["map"].string.nonempty ?? source["name"].string.nonempty ?? source["kind"].string)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }.padding(.top, 8)
                    }
                }
                if !plan["acquisitionAlternatives"].array.isEmpty {
                    DisclosureGroup("Other acquisition routes") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(plan["acquisitionAlternatives"].array.enumerated()), id: \.offset) { _, route in
                                Text(route["summary"].array.map(\.text).joined(separator: " → "))
                            }
                        }.padding(.top, 8)
                    }
                }
                if !plan["rng"]["methods"].array.isEmpty {
                    DisclosureGroup("Available RNG methods") {
                        Text(plan["rng"]["methods"].array.map { HuntProgress.methodName($0.string) }.joined(separator: "\n")).padding(.top, 8)
                    }
                }
                if !plan["limitations"].array.isEmpty {
                    DisclosureGroup("Requirements and limits") {
                        VStack(alignment: .leading, spacing: 8) { ForEach(Array(plan["limitations"].array.enumerated()), id: \.offset) { _, item in Text(item.string) } }.padding(.top, 8)
                    }
                }
            }.font(.callout)
        }
    }
}

func gameDuration(_ milliseconds: Double?) -> String {
    guard let milliseconds, milliseconds.isFinite else { return "—" }
    let seconds = Int(max(0, min(milliseconds / 1000, Double(Int.max / 2))))
    return seconds >= 3600 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String(format: "%d:%02d", seconds / 60, seconds % 60)
}
