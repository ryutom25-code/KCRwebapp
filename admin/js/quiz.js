document.addEventListener('DOMContentLoaded', async () => {
  // Supabase初期化待ち
  let retryCount = 0;
  while (!window.supabaseClient && retryCount < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retryCount++;
  }

  if (!window.supabaseClient) {
    alert('エラー: Supabaseが初期化されていません。');
    return;
  }

  // 4問分の問題入力フォームを画面にレンダリング
  renderQuestionForms();

  // フォーム送信処理（セット + 問題4件を一括保存）
  const form = document.getElementById('createFullQuizForm');
  if (form) {
    form.addEventListener('submit', handleCreateFullQuiz);
  }
});

// 4問分の入力UIを生成
function renderQuestionForms() {
  const container = document.getElementById('questionsContainer');
  if (!container) return;

  let html = '';
  for (let i = 1; i <= 4; i++) {
    html += `
      <div class="card admin-card">
        <h3 style="border-bottom-color: #28a745; color: #28a745;">問題 ${i}</h3>
        
        <div class="form-group">
          <label>問題文</label>
          <textarea id="q${i}_text" class="form-control textarea" placeholder="問題 ${i} の文章を入力" required></textarea>
        </div>

        <div class="form-group">
          <label>選択肢 (4択)</label>
          <input type="text" id="q${i}_opt0" class="form-control option-input" placeholder="選択肢 1" required>
          <input type="text" id="q${i}_opt1" class="form-control option-input" placeholder="選択肢 2" required>
          <input type="text" id="q${i}_opt2" class="form-control option-input" placeholder="選択肢 3" required>
          <input type="text" id="q${i}_opt3" class="form-control option-input" placeholder="選択肢 4" required>
        </div>

        <div class="form-group">
          <label>正解の選択肢</label>
          <select id="q${i}_correct" class="form-control">
            <option value="0">選択肢 1</option>
            <option value="1">選択肢 2</option>
            <option value="2">選択肢 3</option>
            <option value="3">選択肢 4</option>
          </select>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// 一括保存処理
async function handleCreateFullQuiz(e) {
  e.preventDefault();

  const dept = document.getElementById('deptSelect').value;
  const title = document.getElementById('setTitleInput').value.trim();

  // 1. まず quiz_sets にセットを作成
  const { data: setData, error: setError } = await window.supabaseClient
    .from('quiz_sets')
    .insert({ department: dept, title: title })
    .select()
    .single();

  if (setError || !setData) {
    alert('セットの作成に失敗しました: ' + (setError?.message || ''));
    return;
  }

  const setId = setData.id;

  // 2. 4問題分のデータを配列にまとめる
  const quizzesToInsert = [];
  for (let i = 1; i <= 4; i++) {
    const questionText = document.getElementById(`q${i}_text`).value.trim();
    const opt0 = document.getElementById(`q${i}_opt0`).value.trim();
    const opt1 = document.getElementById(`q${i}_opt1`).value.trim();
    const opt2 = document.getElementById(`q${i}_opt2`).value.trim();
    const opt3 = document.getElementById(`q${i}_opt3`).value.trim();
    const correctIndex = parseInt(document.getElementById(`q${i}_correct`).value, 10);

    quizzesToInsert.push({
      set_id: setId,
      question: questionText,
      options: [opt0, opt1, opt2, opt3],
      correct_index: correctIndex,
      points: 10
    });
  }

  // 3. quizzes テーブルへ一括インサート (配列で渡せば1回の通信でOK)
  const { error: quizError } = await window.supabaseClient
    .from('quizzes')
    .insert(quizzesToInsert);

  if (quizError) {
    alert('問題の登録に失敗しました: ' + quizError.message);
  } else {
    alert(`🎉 「${title}」と問題4問を一括登録しました！`);
    document.getElementById('createFullQuizForm').reset();
  }
}