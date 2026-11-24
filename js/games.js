(() => {
  const menu = document.getElementById('gameMenu');
  const play = document.getElementById('gamePlay');
  const title = document.getElementById('gameTitle');
  const rules = document.getElementById('gameRules');
  const board = document.getElementById('gameBoard');
  const score = document.getElementById('gameScore');
  const best = document.getElementById('gameBest');
  const status = document.getElementById('gameStatus');
  const start = document.getElementById('gameStart');
  const records = new Map();
  let active;
  let stopRound = () => {};
  let opener;

  const games = {
    memory: ['神経衰弱', 'カードを2枚ずつめくり、6組のペアを見つけましょう。', memory, '回'],
    mole: ['もぐらたたき', '30秒以内に、顔を出したもぐらをタップしましょう。', mole, '匹'],
    slide: ['スライドパズル', '空欄の隣のパネルを動かし、左上から1〜8の順に並べましょう。', slide, '手'],
    reaction: ['反射神経ゲーム', '「今だ！」に変わったらタップ。早押ししたらやり直しです。', reaction, ' ms']
  };
  const key = () => 'kcr-game-best:' + active;
  function readBest() {
    if (records.has(active)) return records.get(active);
    try {
      const saved = Number(localStorage.getItem(key()));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch {}
    return null;
  }
  function showBest() {
    const record = readBest();
    best.textContent = '自己ベスト ' + (record === null ? '—' : record + games[active][3]);
  }
  function finish(message, value) {
    stopRound();
    status.textContent = message;
    start.textContent = 'もう一度';
    if (value === undefined || value <= 0) return;
    const previous = readBest();
    const improved = previous === null || (active === 'mole' ? value > previous : value < previous);
    if (improved) {
      records.set(active, value);
      try { localStorage.setItem(key(), String(value)); } catch {}
      status.textContent += ' 自己ベスト更新！';
      showBest();
    }
  }
  function makeCell(onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-cell';
    button.addEventListener('click', onClick);
    board.append(button);
    return button;
  }
  function shuffle(values) {
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }
  const secondsSince = time => Math.floor((performance.now() - time) / 1000);

  function memory() {
    const faces = [['⭐', '星'], ['🍎', 'りんご'], ['🐱', 'ねこ'], ['🌻', 'ひまわり'], ['🚀', 'ロケット'], ['🍀', 'クローバー']];
    const deck = shuffle([...faces, ...faces]);
    const matched = new Set();
    const began = performance.now();
    let first = null;
    let turns = 0;
    let revealTimer;
    let locked = false;
    const cells = deck.map((_, index) => makeCell(() => reveal(index)));

    function paint(index, open = false) {
      const cell = cells[index];
      cell.textContent = open ? deck[index][0] : '？';
      cell.classList.toggle('is-open', open);
      cell.classList.toggle('is-match', matched.has(index));
      cell.setAttribute('aria-disabled', String(matched.has(index)));
      const label = open ? deck[index][1] : '裏向き';
      cell.setAttribute('aria-label', `カード${index + 1}、${label}${matched.has(index) ? '、ペア成立' : ''}`);
    }
    function reveal(index) {
      if (locked || matched.has(index) || index === first) return;
      paint(index, true);
      if (first === null) {
        first = index;
        return;
      }
      turns++;
      const previous = first;
      first = null;
      if (deck[previous] === deck[index]) {
        matched.add(previous);
        matched.add(index);
        paint(previous, true);
        paint(index, true);
        status.textContent = 'ペア成立！';
        if (matched.size === deck.length) {
          locked = true;
          finish(`クリア！ ${turns}回・${secondsSince(began)}秒`, turns);
        }
      } else {
        locked = true;
        status.textContent = '絵柄が違います。';
        revealTimer = setTimeout(() => {
          paint(previous);
          paint(index);
          locked = false;
          status.textContent = '';
        }, 700);
      }
      score.textContent = `${matched.size / 2} / 6組 · ${turns}回`;
    }
    stopRound = () => clearTimeout(revealTimer);
    deck.forEach((_, index) => paint(index));
    score.textContent = '0 / 6組 · 0回';
  }

  function mole() {
    const end = performance.now() + 30000;
    let hits = 0;
    let target = -1;
    let done = false;
    let timer;
    const cells = Array.from({ length: 9 }, (_, index) => makeCell(() => {
      if (done) return;
      if (performance.now() >= end) {
        tick();
        return;
      }
      if (target !== index) return;
      hits++;
      moveTarget(-1);
      updateScore();
    }));
    function moveTarget(index) {
      target = index;
      cells.forEach((cell, position) => {
        const visible = position === index;
        cell.classList.toggle('is-target', visible);
        cell.textContent = visible ? '🐹' : '·';
        cell.setAttribute('aria-label', `穴${position + 1}${visible ? '、もぐら出現' : ''}`);
      });
    }
    function updateScore() {
      const remaining = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      score.textContent = `残り ${remaining}秒 · ${hits}匹`;
    }
    function tick() {
      updateScore();
      if (performance.now() >= end) {
        done = true;
        moveTarget(-1);
        finish(`終了！ ${hits}匹`, hits);
      }
    }
    function nextTarget() {
      const candidates = cells.map((_, index) => index).filter(index => index !== target);
      moveTarget(candidates[Math.floor(Math.random() * candidates.length)]);
    }
    const movement = setInterval(nextTarget, 760);
    timer = setInterval(tick, 100);
    stopRound = () => { clearInterval(movement); clearInterval(timer); };
    nextTarget();
    updateScore();
  }

  function slide() {
    const tiles = [1, 2, 3, 4, 5, 6, 7, 8, 0];
    let gap = 8;
    let previousGap = -1;
    let moves = 0;
    let solved = false;
    const began = performance.now();
    const neighbors = index => [index - 3, index + 3, index % 3 ? index - 1 : -1, index % 3 < 2 ? index + 1 : -1]
      .filter(position => position >= 0 && position < 9);
    const isSolved = () => tiles.every((tile, index) => tile === (index + 1) % 9);
    function move(index) {
      [tiles[index], tiles[gap]] = [tiles[gap], tiles[index]];
      previousGap = gap;
      gap = index;
    }
    for (let step = 0; step < 36; step++) {
      const options = neighbors(gap).filter(position => position !== previousGap);
      move(options[Math.floor(Math.random() * options.length)]);
    }
    if (isSolved()) move(neighbors(gap)[0]);
    const cells = tiles.map((_, index) => makeCell(() => {
      if (solved || !neighbors(gap).includes(index)) return;
      move(index);
      moves++;
      score.textContent = moves + '手';
      solved = isSolved();
      paint();
      if (solved) finish(`クリア！ ${moves}手・${secondsSince(began)}秒`, moves);
    }));
    function paint() {
      const adjacent = neighbors(gap);
      tiles.forEach((tile, index) => {
        const cell = cells[index];
        cell.textContent = tile || '';
        cell.classList.toggle('is-gap', tile === 0);
        cell.setAttribute('aria-label', tile ? String(tile) : '空欄');
        cell.setAttribute('aria-disabled', String(solved || !adjacent.includes(index)));
      });
    }
    paint();
    score.textContent = '0手';
  }

  function reaction() {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'game-reaction';
    target.textContent = '合図を待って…';
    board.append(target);
    // Focus during the waiting state so keyboard and touch start at the same time.
    target.focus();
    let readyAt = null;
    const timer = setTimeout(() => {
      target.textContent = '今だ！';
      target.classList.add('is-ready');
      readyAt = performance.now();
    }, 1500 + Math.random() * 2500);
    stopRound = () => clearTimeout(timer);
    target.addEventListener('click', () => {
      const result = readyAt === null ? null : Math.max(1, Math.round(performance.now() - readyAt));
      target.disabled = true;
      if (result === null) {
        finish('早すぎました。合図が出てからタップしてください。');
      } else {
        score.textContent = result + ' ms';
        finish(`反応時間 ${result} ms`, result);
      }
      start.focus();
    }, { once: true });
  }

  menu.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => {
    active = button.dataset.game;
    opener = button;
    menu.hidden = true;
    play.hidden = false;
    title.textContent = games[active][0];
    rules.textContent = games[active][1];
    score.textContent = '';
    status.textContent = '';
    start.textContent = 'スタート';
    showBest();
    title.focus();
  }));
  document.getElementById('gamesBack').addEventListener('click', () => {
    stopRound();
    stopRound = () => {};
    board.replaceChildren();
    play.hidden = true;
    menu.hidden = false;
    opener.focus();
  });
  start.addEventListener('click', () => {
    stopRound();
    stopRound = () => {};
    board.replaceChildren();
    status.textContent = '';
    score.textContent = '';
    start.textContent = 'やり直す';
    games[active][2]();
    board.querySelector('button')?.focus();
  });
})();
