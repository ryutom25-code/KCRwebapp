const DEPARTMENT_NAMES = {
  'PT': '理学療法学科',
  'OT': '作業療法学科',
  'Ns': '看護学科',
  'CW': '介護福祉学科',
  'IS': '情報システム学科'
};

let currentUser = null;
let currentDept = null;
let currentSet = null;
let currentQuizzes = [];
let currentQuizIndex = 0;
let answerProcessing = false;
let quizGeneration = 0;

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
      openQuizSets(dept).catch(error => App.notify(error.message));
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
  if (answerProcessing) return;
  quizGeneration++;
  const step3 = document.getElementById('step3Play');
  const step2 = document.getElementById('step2Sets');
  
  if (step3.style.display !== 'none') {
    openQuizSets(currentDept).catch(error => App.notify(error.message)); // STEP 3 -> STEP 2
  } else if (step2.style.display !== 'none') {
    showStep(1); // STEP 2 -> STEP 1
  }
}

// STEP 2: クイズセット一覧取得＆残問題数計算
async function openQuizSets(dept) {
  if (answerProcessing) return;
  const generation = ++quizGeneration;
  currentDept = dept;
  const container = document.getElementById('quizSetList');
  document.getElementById('deptNameLabel').textContent = `【${DEPARTMENT_NAMES[dept]}】のクイズセット`;
  container.innerHTML = '<p>読み込み中...</p>';

  showStep(2);

  // 1. クイズセット一覧取得
  const { data: sets, error: setsError } = await App.fetchAllResult(() => window.supabaseClient
    .from('quiz_sets')
    .select('*')
    .eq('department', dept)
    .order('created_at', { ascending: true }).order('id'));

  if (generation !== quizGeneration) return;
  if (setsError) { container.textContent = 'クイズ一覧を取得できませんでした。'; return; }
  if (!sets || sets.length === 0) {
    container.innerHTML = '<p>現在用意されているクイズはありません。</p>';
    return;
  }

  // 2. 自分の【正解済み（is_correct = true）】履歴だけを取得
  const { data: userAnswers, error: answersError } = await App.fetchAllResult(() => window.supabaseClient
    .from('quiz_answers')
    .select('quiz_id')
    .eq('user_id', currentUser.id)
    .eq('is_correct', true).order('id'));

  if (generation !== quizGeneration) return;
  if (answersError) throw new Error('正解済みの問題を取得できませんでした。');
  const clearedQuizIds = new Set(userAnswers.map(a => a.quiz_id));

  // 3. 各セット内の全問題数を取得してHTML生成
  let html = '';
  for (const set of sets) {
    const { data: quizzes, error: questionsError } = await App.fetchAllResult(() => window.supabaseClient
      .from('quizzes')
      .select('id')
      .eq('set_id', set.id).order('id'));

    if (generation !== quizGeneration) return;
    if (questionsError) { container.textContent = '問題一覧を取得できませんでした。'; return; }
    const totalCount = quizzes ? quizzes.length : 0;
    // 正解済みの問題数
    const clearedCount = quizzes ? quizzes.filter(q => clearedQuizIds.has(q.id)).length : 0;
    const remainingCount = totalCount - clearedCount;
    const isCompleted = totalCount > 0 && remainingCount === 0;

    if (isCompleted) {
      // 全問正解クリア済み（完了状態）
      html += `
        <div class="card completed-quiz">
          <div>
            <div>
              <strong>${App.escapeHtml(set.title)}</strong>
              <div>全 ${totalCount} 問クリア済み</div>
            </div>
            <span>CLEAR</span>
          </div>
        </div>
      `;
    } else {
      // 未クリア問題あり（挑戦可能）
      html += `
        <button type="button" class="card quiz-set-card" data-set-index="${sets.indexOf(set)}">
          <div>
            <div>
              <strong>${App.escapeHtml(set.title)}</strong>
              <div>未クリア ${remainingCount} 問 / 全 ${totalCount} 問</div>
            </div>
            <span>挑戦 ›</span>
          </div>
        </button>
      `;
    }
  }

  container.innerHTML = html;
  container.querySelectorAll('[data-set-index]').forEach(card => {
    card.addEventListener('click', () => {
      const set = sets[Number(card.dataset.setIndex)];
      startQuizSet(set.id, set.title).catch(error => App.notify(error.message));
    });
  });
}

// STEP 3: クイズスタート
async function startQuizSet(setId, title) {
  if (answerProcessing) return;
  const generation = ++quizGeneration;

  // 全問題を取得
  const { data: quizzes, error: quizError } = await App.fetchAllResult(() => window.supabaseClient
    .from('quizzes')
    .select('id, set_id, question, options, points')
    .eq('set_id', setId)
    .order('id', { ascending: true }));

  // 自分の【正解済み】問題IDを取得
  const { data: userAnswers, error: answersError } = await App.fetchAllResult(() => window.supabaseClient
    .from('quiz_answers')
    .select('quiz_id')
    .eq('user_id', currentUser.id)
    .eq('set_id', setId)
    .eq('is_correct', true).order('id'));

  if (generation !== quizGeneration) return;
  if (answersError) throw new Error('正解済みの問題を取得できませんでした。');
  const clearedQuizIds = new Set(userAnswers.map(a => a.quiz_id));

  // 未正解（まだクリアしていない）問題だけに絞り込む
  if (quizError || !quizzes) throw quizError || new Error('問題を取得できませんでした。');
  currentSet = { id: setId, title: title };
  currentQuizzes = quizzes.filter(q => !clearedQuizIds.has(q.id));
  currentQuizIndex = 0;

  if (currentQuizzes.length === 0) {
    App.notify('このクイズセットはすべてクリア済みです！');
    openQuizSets(currentDept).catch(error => App.notify(error.message));
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
    App.notify('🎉 おめでとうございます！未クリア問題をすべてクリアしました！');
    openQuizSets(currentDept).catch(error => App.notify(error.message));
    return;
  }

  const q = currentQuizzes[currentQuizIndex];
  document.getElementById('quizProgressText').textContent = `問題 ${currentQuizIndex + 1} / ${currentQuizzes.length}`;
  document.getElementById('questionText').textContent = q.question;

  const container = document.getElementById('optionsContainer');
  container.innerHTML = q.options.map((optText, idx) => `
    <button type="button" class="btn option-btn" onclick="submitAnswer(${idx})">
      ${idx + 1}. ${App.escapeHtml(optText)}
    </button>
  `).join('');
}

// The correct answer and awarded amount are verified on the server.
async function submitAnswer(selectedIndex) {
  if (answerProcessing) return;
  answerProcessing = true;
  const generation = quizGeneration;
  const q = currentQuizzes[currentQuizIndex];
  const feedback = document.getElementById('resultFeedback');
  document.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);
  try {
    const result = await App.rpc('answer_quiz', { p_quiz_id: String(q.id), p_selected_index: selectedIndex });
    feedback.style.color = result.isCorrect ? '#28a745' : '#dc3545';
    feedback.textContent = result.isCorrect
      ? (result.alreadyAnswered ? 'この問題は正解済みです。' : `🎉 正解！ (+${result.earnedPoints} PT獲得)`)
      : '❌ 不正解... もう一度挑戦してみよう！';
    setTimeout(() => {
      answerProcessing = false;
      if (generation !== quizGeneration) return;
      if (result.isCorrect) {
        currentQuizIndex++;
        renderQuizQuestion();
      } else {
        feedback.textContent = '';
        document.querySelectorAll('.option-btn').forEach(btn => btn.disabled = false);
      }
    }, 1500);
  } catch (error) {
    answerProcessing = false;
    feedback.style.color = '#dc3545';
    feedback.textContent = '保存できませんでした: ' + error.message;
    document.querySelectorAll('.option-btn').forEach(btn => btn.disabled = false);
  }
}
