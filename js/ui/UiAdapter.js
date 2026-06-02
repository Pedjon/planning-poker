// Driving adapter: implements the UI port. Pure DOM rendering from a
// view-model; knows nothing about the store, transport, or domain rules
// (beyond the DECK it needs to draw the hand).
import { els, VIEWS } from './elements.js';
import { DECK } from '../domain/deck.js';

export class UiAdapter {
  // `onVote(value)` is called when the user clicks a card.
  constructor({ onVote } = {}) {
    this.onVote = onVote || (() => {});
  }

  setStatus(text, kind) {
    els.badge.textContent = text;
    els.badge.className = 'badge badge--' + kind;
  }

  goTo(view) {
    VIEWS.forEach((name) => els[name].classList.add('hidden'));
    els[view].classList.remove('hidden');
  }

  copy(textarea) {
    textarea.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textarea.value).catch(() => {});
    }
  }

  render(vm) {
    const { session, role } = vm;
    els.roundNum.textContent = session.round;
    els.rolePill.textContent = role === 'host' ? 'Host' : 'Participant';
    els.tableSub.textContent = session.revealed ? 'Cards revealed' : 'Pick your card';

    if (role === 'host') {
      els.reveal.classList.toggle('hidden', session.revealed);
      els.reset.classList.remove('hidden');
      els.addPeer.classList.remove('hidden');
    }

    this._renderParticipants(vm);
    this._renderResults(vm);
    this._renderDeck(vm);
  }

  _renderParticipants(vm) {
    const { session, participants, selfId } = vm;
    els.participants.innerHTML = '';
    participants.forEach((p) => {
      const seat = document.createElement('div');
      seat.className = 'seat';

      const card = document.createElement('div');
      card.className = 'seat__card';
      if (session.revealed) {
        card.classList.add('seat__card--revealed');
        card.textContent = p.hasVoted ? String(p.vote) : '-';
      } else if (p.hasVoted) {
        card.classList.add('seat__card--voted');
        card.textContent = '\u2714';
      } else {
        card.textContent = '';
      }

      const name = document.createElement('div');
      name.className = 'seat__name';
      if (p.id === selfId) name.classList.add('seat__name--you');
      name.textContent = p.name + (p.id === selfId ? ' (you)' : '');

      const tag = document.createElement('span');
      tag.className = 'seat__tag';
      tag.textContent = session.revealed ? '' : (p.hasVoted ? 'voted' : 'thinking');

      seat.appendChild(card);
      seat.appendChild(name);
      seat.appendChild(tag);
      els.participants.appendChild(seat);
    });
  }

  _renderResults(vm) {
    if (!vm.session.revealed) {
      els.resultBar.classList.add('hidden');
      return;
    }
    els.avgValue.textContent = vm.results.average;
    els.consensusValue.textContent = vm.results.consensus;
    els.resultBar.classList.remove('hidden');
  }

  _renderDeck(vm) {
    els.deck.innerHTML = '';
    DECK.forEach((value) => {
      const btn = document.createElement('button');
      btn.className = 'card-btn';
      if (vm.myVote === value) btn.classList.add('card-btn--selected');
      btn.textContent = String(value);
      btn.disabled = vm.session.revealed;
      btn.onclick = () => this.onVote(value);
      els.deck.appendChild(btn);
    });
  }
}
