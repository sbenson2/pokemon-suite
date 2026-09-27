(() => {
  'use strict';

  const DEBUG_V1 = 'agentland-master-red-debug/v1';
  const DEBUG_V2 = 'agentland-master-red-debug/v2';
  const DECISION_V2 = 'agentland-master-red-decision/v2';

  function text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function isFinalizedV2Decision(value) {
    if (!value || value.schema !== DECISION_V2) return false;
    return value.lifecycle?.state === 'finalized'
      || value.lifecycle?.finalized === true
      || Boolean(value.clock?.finalizedAt);
  }

  function mapParts(state) {
    const mapValue = state?.map;
    let map = '';
    if (typeof mapValue === 'string' || typeof mapValue === 'number') {
      map = String(mapValue);
    } else if (mapValue && typeof mapValue === 'object') {
      map = text(mapValue.name || mapValue.id || mapValue.key);
    }
    if (!map && Number.isFinite(Number(state?.mapGroup))
      && Number.isFinite(Number(state?.mapNum))) {
      map = `${Number(state.mapGroup)}.${Number(state.mapNum)}`;
    }
    const x = state?.x ?? (mapValue && typeof mapValue === 'object' ? mapValue.x : undefined);
    const y = state?.y ?? (mapValue && typeof mapValue === 'object' ? mapValue.y : undefined);
    return {map, x, y};
  }

  function diagnosisLabel(diagnosis) {
    if (!diagnosis || typeof diagnosis !== 'object') return 'not reported';
    const code = text(diagnosis.code) || 'unknown';
    const diagnosisClass = text(diagnosis.class);
    const recovery = text(diagnosis.recovery);
    const detail = text(diagnosis.detail);
    return [code === 'ok' ? 'OK' : code, diagnosisClass, recovery && recovery !== 'none'
      ? `recovery ${recovery}` : '', detail].filter(Boolean).join(' · ');
  }

  function arbitrationLabel(arbitration) {
    if (!arbitration || typeof arbitration !== 'object') return 'not reported';
    const tier = text(arbitration.tier) || 'unclassified tier';
    const eligible = Number.isFinite(Number(arbitration.eligibleCandidates))
      ? Number(arbitration.eligibleCandidates) : null;
    const total = Number.isFinite(Number(arbitration.totalCandidates))
      ? Number(arbitration.totalCandidates) : null;
    const candidates = eligible === null ? ''
      : `${eligible}/${total === null ? '?' : total} eligible`;
    const winner = text(arbitration.winnerId);
    const invariant = arbitration.invariant && arbitration.invariant.ok === false
      ? `invariant ${text(arbitration.invariant.code) || 'failed'}` : '';
    return [tier, arbitration.hardTier === true ? 'hard tier' : '', candidates,
      winner ? `winner ${winner}` : '', invariant].filter(Boolean).join(' · ');
  }

  function normalizeDiagnosis(value) {
    return value && typeof value === 'object' ? value : null;
  }

  function isHealthyDiagnosis(value) {
    const diagnosis = normalizeDiagnosis(value);
    const code = text(diagnosis?.code).toLowerCase();
    const diagnosisClass = text(diagnosis?.class).toLowerCase();
    return Boolean(diagnosis) && (code === 'ok' || code === 'none'
      || diagnosisClass === 'healthy');
  }

  function diagnosisAlert(diagnosis) {
    const value = normalizeDiagnosis(diagnosis);
    const code = text(value?.code).toLowerCase();
    if (!value || !code || isHealthyDiagnosis(value)) return null;
    const severity = text(value.severity).toLowerCase();
    return {
      level: ['critical', 'error', 'fatal'].includes(severity) ? 'error' : 'warning',
      code: text(value.code) || 'decision-diagnosis',
      message: text(value.detail) || diagnosisLabel(value),
    };
  }

  function normalizeV2Decision(decision) {
    const state = decision.state && typeof decision.state === 'object' ? decision.state : {};
    const action = decision.action && typeof decision.action === 'object' ? decision.action : {};
    const observation = decision.observation && typeof decision.observation === 'object'
      ? decision.observation : {};
    const arbitration = decision.arbitration && typeof decision.arbitration === 'object'
      ? decision.arbitration : {};
    const progress = decision.progress && typeof decision.progress === 'object'
      ? decision.progress : {};
    const diagnosis = normalizeDiagnosis(decision.diagnosis)
      || (Array.isArray(decision.diagnoses)
        ? decision.diagnoses.find((entry) => entry && typeof entry === 'object') : null);
    const location = mapParts(state);
    const requested = text(action.requested || action.primitive || action.name) || 'no input';
    const phase = text(state.phase) || 'unknown';
    const goal = text(state.goalId || state.goal);
    const campaign = text(state.campaignId || state.campaign);
    const sequence = decision.sequence ?? decision.clock?.sequence ?? '?';
    return {
      schema: DECISION_V2,
      decisionId: text(decision.decisionId),
      sequence,
      emulatedMs: number(decision.clock?.emulatedMs),
      finalizedAt: text(decision.clock?.finalizedAt),
      action: requested,
      phase,
      map: location.map,
      x: location.x,
      y: location.y,
      goal,
      campaign,
      control: state.control && typeof state.control === 'object' ? state.control : null,
      arbitration,
      arbitrationLabel: arbitrationLabel(arbitration),
      diagnosis,
      diagnosisLabel: diagnosisLabel(diagnosis),
      progress,
      inputMask: number(action.resolvedInputMask ?? observation.actualInputMask),
      observation,
      branch: text(arbitration.tier),
      stateLabel: [phase, location.map
        ? `${location.map} @ ${location.x ?? '?'},${location.y ?? '?'}` : ''].filter(Boolean).join(' · '),
      raw: decision,
    };
  }

  function projectV1(debug) {
    return {
      ...debug,
      version: 'v1',
      status: debug.current ? 'live' : 'waiting',
      diagnosis: null,
    };
  }

  function projectV2(debug) {
    const finalized = Array.isArray(debug.decisionsV2)
      ? debug.decisionsV2.filter(isFinalizedV2Decision) : [];
    const explicitCurrent = isFinalizedV2Decision(debug.currentDecisionV2)
      ? debug.currentDecisionV2 : null;
    if (explicitCurrent && !finalized.some((entry) => entry.decisionId
      && entry.decisionId === explicitCurrent.decisionId)) {
      finalized.push(explicitCurrent);
    }
    const decisions = finalized.map(normalizeV2Decision);
    const current = explicitCurrent ? normalizeV2Decision(explicitCurrent)
      : decisions.at(-1) || null;
    const diagnosis = normalizeDiagnosis(debug.diagnosis) || current?.diagnosis || null;
    const alerts = [];
    if (Array.isArray(debug.alerts)) {
      alerts.push(...debug.alerts.filter((entry) => !isHealthyDiagnosis(entry)));
    }
    const diagnosticAlert = diagnosisAlert(diagnosis);
    if (diagnosticAlert && !alerts.some((entry) => entry?.code === diagnosticAlert.code)) {
      alerts.push(diagnosticAlert);
    }
    return {
      schema: DEBUG_V2,
      version: 'v2',
      status: current ? 'live' : 'ready',
      sequence: current?.sequence ?? 0,
      updatedAt: debug.updatedAt || null,
      emulatedMs: number(debug.emulatedMs, current?.emulatedMs || 0),
      current,
      decisions,
      alerts,
      health: {},
      diagnosis,
      diagnosisLabel: diagnosisLabel(diagnosis),
      runtimeGate: debug.runtimeGate && typeof debug.runtimeGate === 'object'
        ? debug.runtimeGate : null,
    };
  }

  function project(debug) {
    if (!debug || typeof debug !== 'object') return null;
    if (debug.schema === DEBUG_V1) return projectV1(debug);
    if (debug.schema === DEBUG_V2) return projectV2(debug);
    return null;
  }

  globalThis.AgentLandMasterRedTrace = Object.freeze({
    DEBUG_V1,
    DEBUG_V2,
    DECISION_V2,
    arbitrationLabel,
    diagnosisLabel,
    isFinalizedV2Decision,
    project,
  });
})();
