const DEPARTMENT_NAMES = {
  'PT': '理学療法学科',
  'OT': '作業療法学科',
  'Ns': '看護学科',
  'CW': '介護福祉学科',
  'IS': '情報処理学科'
};

let currentUser = null;
let currentDept = null;
let currentSet = null;
let currentQuizzes = [];
let currentQuizIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  // 学科選択ボタンの設定
  document.querySelectorAll('.dept-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dept = btn.getAttribute('data-dept');
      openQuizSets(dept);
    });
  });

  // 戻るボタンの挙動制御
  document.getElementById('backBtn').addEventListener('click', handleBack);
});

// STEP切り替え関数
function showStep(stepNumber) {
  document.querySelectorAll('.quiz-step').forEach(el => el.style.display = 'none');
  const backBtn = document.getElementById('backBtn');
  const homeLink = document.getElementById('homeLink');

  if (stepNumber === 1) {
    document.getElementById('step1Dept').style.display = 'block';
    document.getElementById('headerTitle').textContent = '学科クイズ';
    backBtn.style.display = 'none';
    homeLink.style.display = 'inline-block';
  } else if (stepNumber === 2) {
    document.getElementById('step2Sets').style.display = 'block';
    document.getElementById('headerTitle').textContent = DEPARTMENT_NAMES[currentDept] || 'クイズセット';
    backBtn.style.display = 'inline-block';
    homeLink.style.display = 'none';
  } else if (stepNumber === 3) {
    document.getElementById('step3Play').style.display = 'block';
    document.getElementById('headerTitle').textContent = currentSet.title;
    backBtn.style.display = 'inline-block';
    homeLink.style.display = 'none';
  }
}

function handleBack() {
  const step3 = document.getElementById('step3Play');
  const step2 = document.getElementById('step2Sets');
  
  if (step3.style.display !== 'none') {
    openQuizSets(currentDept); // STEP 3 -> STEP 2
  } else if (step2.style.display !== 'none') {
    showStep(1); // STEP 2 -> STEP 1
  }
}

// STEP 2: クイズセット一覧取得＆残問題数計算
async function openQuizSets(dept) {
  currentDept = dept;
  const container = document.getElementById('quizSetList');
  document.getElementById('deptNameLabel').textContent = `【${DEPARTMENT_NAMES[dept]}】のクイズセット`;
  container.innerHTML = '<p style="text-align: center; color: #888;">読み込み中...</p>';

  showStep(2);

  // 1. クイズセット一覧取得
  const { data: sets } = await window.supabaseClient
    .from('quiz_sets')
    .select('*')
    .eq('department', dept)
    .order('created_at', { ascending: true });

  if (!sets || sets.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">現在用意されているクイズはありません。</p>';
    return;
  }

  // 2. 自分の【正解済み（is_correct = true）】履歴だけを取得
  const { data: userAnswers } = await window.supabaseClient
    .from('quiz_answers')
    .select('quiz_id')
    .eq('user_id', currentUser.id)
    .eq('is_correct', true);

  const clearedQuizIds = new Set(userAnswers ? userAnswers.map(a => a.quiz_id) : []);

  // 3. 各セット内の全問題数を取得してHTML生成
  let html = '';
  for (const set of sets) {
    const { data: quizzes } = await window.supabaseClient
      .from('quizzes')
      .select('id')
      .eq('set_id', set.id);

    const totalCount = quizzes ? quizzes.length : 0;
    // 正解済みの問題数
    const clearedCount = quizzes ? quizzes.filter(q => clearedQuizIds.has(q.id)).length : 0;
    const remainingCount = totalCount - clearedCount;
    const isCompleted = totalCount > 0 && remainingCount === 0;

    if (isCompleted) {
      // 全問正解クリア済み（完了状態）
      html += `
        <div class="card" style="background: #f0f0f0; border-color: #ccc; opacity: 0.7; cursor: not-allowed;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: #666;">${set.title}</strong>
              <div style="font-size: 0.8rem; color: #888; margin-top: 4px;">全 ${totalCount} 問クリア済み</div>
            </div>
            <span style="background: #28a745; color: white; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px; font-weight: bold;">CLEAR</span>
          </div>
        </div>
      `;
    } else {
      // 未クリア問題あり（挑戦可能）
      html += `
        <div class="card quiz-set-card" onclick="startQuizSet('${set.id}', '${set.title}')" style="cursor: pointer;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: #333; font-size: 1rem;">${set.title}</strong>
              <div style="font-size: 0.8rem; color: #007aff; margin-top: 4px;">未クリア ${remainingCount} 問 / 全 ${totalCount} 問</div>
            </div>
            <span style="font-size: 1.2rem; color: #007aff;">挑戦 ›</span>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

// STEP 3: クイズスタート
async function startQuizSet(setId, title) {
  currentSet = { id: setId, title: title };

  // 全問題を取得
  const { data: quizzes } = await window.supabaseClient
    .from('quizzes')
    .select('*')
    .eq('set_id', setId)
    .order('id', { ascending: true });

  // 自分の【正解済み】問題IDを取得
  const { data: userAnswers } = await window.supabaseClient
    .from('quiz_answers')
    .select('quiz_id')
    .eq('user_id', currentUser.id)
    .eq('set_id', setId)
    .eq('is_correct', true);

  const clearedQuizIds = new Set(userAnswers ? userAnswers.map(a => a.quiz_id) : []);

  // 未正解（まだクリアしていない）問題だけに絞り込む
  currentQuizzes = quizzes.filter(q => !clearedQuizIds.has(q.id));
  currentQuizIndex = 0;

  if (currentQuizzes.length === 0) {
    alert('このクイズセットはすべてクリア済みです！');
    openQuizSets(currentDept);
    return;
  }

  showStep(3);
  renderQuizQuestion();
}

// 問題の描画
function renderQuizQuestion() {
  const feedback = document.getElementById('resultFeedback');
  feedback.textContent = '';

  if (currentQuizIndex >= currentQuizzes.length) {
    // 未クリア分を全問正解 -> セット一覧に戻る
    alert('🎉 おめでとうございます！未クリア問題をすべてクリアしました！');
    openQuizSets(currentDept);
    return;
  }

  const q = currentQuizzes[currentQuizIndex];
  document.getElementById('quizProgressText').textContent = `問題 ${currentQuizIndex + 1} / ${currentQuizzes.length}`;
  document.getElementById('questionText').textContent = q.question;

  const container = document.getElementById('optionsContainer');
  container.innerHTML = q.options.map((optText, idx) => `
    <button type="button" class="btn option-btn" onclick="submitAnswer(${idx})" style="width: 100%; text-align: left; padding: 12px 15px; background: #f8f9fa; border: 1px solid #ddd; color: #333; border-radius: 8px;">
      ${idx + 1}. ${optText}
    </button>
  `).join('');
}

// 解答判定＆ポイント付与
async function submitAnswer(selectedIndex) {
  const q = currentQuizzes[currentQuizIndex];
  const isCorrect = (selectedIndex === q.correct_index);
  const feedback = document.getElementById('resultFeedback');

  // ボタンを一時無効化（連打防止）
  document.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);

  if (isCorrect) {
    feedback.style.color = '#28a745';
    feedback.textContent = '🎉 正解！ (+10 PT獲得)';

    // 1. quiz_answers に正解として記録（次回からスキップされる）
    await window.supabaseClient.from('quiz_answers').insert({
      user_id: currentUser.id,
      set_id: currentSet.id,
      quiz_id: q.id,
      is_correct: true
    });

    // 2. profiles ポイント加算
    const { data: profile } = await window.supabaseClient
      .from('profiles')
      .select('points')
      .eq('id', currentUser.id)
      .single();

    const newPoints = (profile?.points || 0) + 10;
    await window.supabaseClient.from('profiles').update({ points: newPoints }).eq('id', currentUser.id);

    // 3. point_history 記録
    await window.supabaseClient.from('point_history').insert({
      user_id: currentUser.id,
      title: `${DEPARTMENT_NAMES[currentDept]} クイズ正解`,
      category: 'quiz',
      points: 10
    });

    // 1.5秒後に次の問題へ進む
    setTimeout(() => {
      currentQuizIndex++;
      renderQuizQuestion();
    }, 1500);

  } else {
    feedback.style.color = '#dc3545';
    feedback.textContent = '❌ 不正解... もう一度挑戦してみよう！';

    // 💡 不正解の時は DB に保存せず、1.5秒後に選択肢のロックを解除して再挑戦させる
    setTimeout(() => {
      feedback.textContent = '';
      document.querySelectorAll('.option-btn').forEach(btn => btn.disabled = false);
    }, 1500);
  }
}