// UI: single source of DOM element lookups.
const $ = (id) => document.getElementById(id);

export const els = {
  badge: $('connBadge'),
  setup: $('setupView'),
  hostSignal: $('hostSignalView'),
  joinSignal: $('joinSignalView'),
  table: $('tableView'),
  name: $('nameInput'),
  setupTitle: $('setupTitle'),
  hostBtn: $('hostBtn'),
  joinBtn: $('joinBtn'),
  setupHint: $('setupHint'),
  // host signaling
  hostInviteBtn: $('hostInviteBtn'),
  hostInviteField: $('hostInviteField'),
  hostInviteOut: $('hostInviteOutput'),
  hostInviteCopy: $('hostInviteCopyBtn'),
  hostHint: $('hostHint'),
  hostRespIn: $('hostResponseInput'),
  hostConnect: $('hostConnectBtn'),
  hostEnter: $('hostEnterBtn'),
  // join signaling
  joinInviteIn: $('joinInviteInput'),
  joinRespond: $('joinRespondBtn'),
  joinRespField: $('joinResponseField'),
  joinRespOut: $('joinResponseOutput'),
  joinRespCopy: $('joinResponseCopyBtn'),
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
