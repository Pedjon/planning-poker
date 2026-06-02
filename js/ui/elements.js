// UI: single source of DOM element lookups.
const $ = (id) => document.getElementById(id);

export const els = {
  badge: $('connBadge'),
  setup: $('setupView'),
  hostSignal: $('hostSignalView'),
  joinSignal: $('joinSignalView'),
  table: $('tableView'),
  name: $('nameInput'),
  hostBtn: $('hostBtn'),
  joinBtn: $('joinBtn'),
  setupHint: $('setupHint'),
  // host signaling
  hostReqIn: $('hostRequestInput'),
  hostGen: $('hostGenerateBtn'),
  hostAnsField: $('hostAnswerField'),
  hostAnsOut: $('hostAnswerOutput'),
  hostCopy: $('hostCopyBtn'),
  hostEnter: $('hostEnterBtn'),
  // join signaling
  joinGen: $('joinGenerateBtn'),
  joinReqField: $('joinRequestField'),
  joinReqOut: $('joinRequestOutput'),
  joinCopy: $('joinCopyBtn'),
  joinAnsField: $('joinAnswerField'),
  joinAnsIn: $('joinAnswerInput'),
  joinConnect: $('joinConnectBtn'),
  // table
  roundNum: $('roundNum'),
  tableSub: $('tableSub'),
  rolePill: $('rolePill'),
  addPeer: $('addPeerBtn'),
  reveal: $('revealBtn'),
  reset: $('resetBtn'),
  participants: $('participants'),
  resultBar: $('resultBar'),
  avgValue: $('avgValue'),
  consensusValue: $('consensusValue'),
  deck: $('deck')
};

export const VIEWS = ['setup', 'hostSignal', 'joinSignal', 'table'];
