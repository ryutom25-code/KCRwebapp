document.addEventListener('DOMContentLoaded', async () => {
  // Supabase初期化待ち
  if (!await App.initAdminPage()) return;

  // 4問分の問題入力フォームを画面にレンダリング
  renderQuestionForms();
  loadManagedQuizzes();
  document.getElementById('reloadQuizzes').addEventListener('click', loadManagedQuizzes);
  document.getElementById('newQuizBtn').addEventListener('click', () => showQuizCreateView(true));
  document.getElementById('backToQuizList').addEventListener('click', () => showQuizCreateView(false));

  // フォーム送信処理（セット + 問題4件を一括保存）
  const form = document.getElementById('createFullQuizForm');
  if (form) {
    form.addEventListener('submit', handleCreateFullQuiz);
  }
});

// Keep the list and creation flow separate; returning preserves an unsaved draft.
function showQuizCreateView(creating) {
  document.getElementById('quizListView').hidden = creating;
  document.getElementById('quizCreateView').hidden = !creating;
  document.getElementById('quizPageTitle').textContent = creating ? '新しいクイズをつくる。' : 'クイズを管理する。';
  document.getElementById('quizPageDescription').textContent = creating
    ? '学科を選んで、4つの問題と正解を登録します。'
    : '作成済みのクイズを確認・編集できます。新しいセットは「新規作成」から追加してください。';
  document.getElementById(creating ? 'setTitleInput' : 'newQuizBtn').focus({ preventScroll: true });
  document.getElementById('main').scrollIntoView({ block: 'start' });
}

// 4問分の入力UIを生成
function renderQuestionForms() {
  const container=document.getElementById('questionsContainer');
  if(!container)return;
  container.innerHTML=Array.from({length:4},(_,index)=>{
    const i=index+1;
    return `<section class="card"><span class="eyebrow">QUESTION 0${i}</span><h2>問題 ${i}</h2><div class="form-group"><label for="q${i}_text">問題文</label><textarea id="q${i}_text" required placeholder="問題文を入力してください"></textarea></div><fieldset><legend>選択肢</legend>${Array.from({length:4},(_,n)=>`<div class="form-group"><label for="q${i}_opt${n}">選択肢 ${n+1}</label><input id="q${i}_opt${n}" required placeholder="選択肢 ${n+1}"></div>`).join('')}</fieldset><div class="form-group"><label for="q${i}_correct">正解の選択肢</label><select id="q${i}_correct">${Array.from({length:4},(_,n)=>`<option value="${n}">選択肢 ${n+1}</option>`).join('')}</select></div></section>`;
  }).join('');
}

// 一括保存処理
async function handleCreateFullQuiz(e) {
  e.preventDefault();

  const dept = document.getElementById('deptSelect').value;
  const title = document.getElementById('setTitleInput').value.trim();

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
      question: questionText,
      options: [opt0, opt1, opt2, opt3],
      correct_index: correctIndex,
      points: 10
    });
  }

  const button = e.target.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  document.getElementById('backToQuizList').disabled = true;
  try {
    await App.rpc('create_quiz_set', { p_department: dept, p_title: title, p_quizzes: quizzesToInsert });
    App.notify(`🎉 「${title}」と問題4問を一括登録しました！`);
    e.target.reset();
    await loadManagedQuizzes();
    showQuizCreateView(false);
  } catch (error) {
    App.notify('登録に失敗しました: ' + error.message);
  } finally {
    button.disabled = false;
    document.getElementById('backToQuizList').disabled = false;
  }
}

let managedQuizGeneration=0;
async function loadManagedQuizzes(){
  const host=document.getElementById('quizManagementList');
  const generation=++managedQuizGeneration;
  host.innerHTML='<p class="empty">読み込み中…</p>';
  try{
    const sets=await App.rpc('get_quiz_management');
    if(generation!==managedQuizGeneration)return;
    if(!sets?.length){host.innerHTML='<p class="empty">作成済みのクイズはありません。</p>';return;}
    host.replaceChildren();
    for(const set of sets){
      const section=document.createElement('details');section.className='quiz-set-item';
      section.innerHTML=`<summary>${App.escapeHtml(set.title)} <span class="quiz-set-meta">${App.escapeHtml(set.department)} / ${set.quizzes.length}問</span></summary><div class="quiz-set-settings"><label>セットタイトル<input data-set-title value="${App.escapeHtml(set.title)}" required></label><label>対象学科<select data-set-department>${[['PT','理学療法学科'],['OT','作業療法学科'],['Ns','看護学科'],['CW','介護福祉学科'],['IS','情報システム学科']].map(([id,name])=>`<option value="${id}" ${id===set.department?'selected':''}>${name}</option>`).join('')}</select></label><div class="quiz-question-actions"><button type="button" class="btn btn-secondary" data-save-set>セット情報を保存</button><button type="button" class="btn-delete" data-delete-set>セット全体を削除</button></div></div><div class="quiz-question-list"></div>`;
      section.querySelector('[data-save-set]').onclick=async event=>{
        const title=section.querySelector('[data-set-title]').value.trim();
        if(!title){App.notify('タイトルを入力してください。');return;}
        await runQuizAction(event.currentTarget,()=>App.rpc('update_quiz_set',{p_set_id:String(set.id),p_title:title,p_department:section.querySelector('[data-set-department]').value}),'セット情報を保存しました。',true);
      };
      section.querySelector('[data-delete-set]').onclick=async event=>{
        const button=event.currentTarget;
        if(!await App.confirm(`「${set.title}」と全問題・回答記録を削除しますか？獲得済みポイントとポイント履歴は残ります。`))return;
        await runQuizAction(button,()=>App.rpc('delete_quiz_set',{p_set_id:String(set.id)}),'セットを削除しました。',true);
      };
      for(const [index,q] of set.quizzes.entries()){
        const form=document.createElement('form');form.className='quiz-question-editor';
        form.innerHTML=`<h3>問題 ${index+1}</h3><label>問題文<textarea data-question required></textarea></label><fieldset><legend>選択肢</legend>${q.options.map((_,n)=>`<label>選択肢 ${n+1}<input data-option="${n}" required></label>`).join('')}</fieldset><label>正解<select data-correct>${q.options.map((_,n)=>`<option value="${n}">選択肢 ${n+1}</option>`).join('')}</select></label><div class="quiz-question-actions"><button type="button" class="btn-delete" data-delete-question>この問題を削除</button><button type="submit" class="btn btn-primary">変更を保存</button></div>`;
        form.querySelector('[data-question]').value=q.question;
        form.querySelectorAll('[data-option]').forEach((el,n)=>el.value=q.options[n]);
        form.querySelector('[data-correct]').value=q.correct_index;
        form.onsubmit=async event=>{
          event.preventDefault();
          const text=form.querySelector('[data-question]').value.trim(),opts=[...form.querySelectorAll('[data-option]')].map(el=>el.value.trim());
          if(!text||opts.some(v=>!v)){App.notify('問題文と選択肢を入力してください。');return;}
          await runQuizAction(form.querySelector('[type=submit]'),()=>App.rpc('update_quiz',{p_quiz_id:String(q.id),p_question:text,p_options:opts,p_correct_index:Number(form.querySelector('[data-correct]').value)}),'問題を保存しました。');
        };
        form.querySelector('[data-delete-question]').onclick=async event=>{
          const button=event.currentTarget;
          if(!await App.confirm('この問題と回答記録を削除しますか？獲得済みポイントとポイント履歴は残ります。'))return;
          await runQuizAction(button,()=>App.rpc('delete_quiz',{p_quiz_id:String(q.id)}),'問題を削除しました。',true);
        };
        section.querySelector('.quiz-question-list').append(form);
      }
      host.append(section);
    }
  }catch(error){if(generation===managedQuizGeneration)host.textContent='クイズを取得できませんでした: '+error.message;}
}
async function runQuizAction(button,action,message,reload=false){
  if(button.disabled)return;
  button.disabled=true;
  try{await action();App.notify(message);if(reload)await loadManagedQuizzes();}
  catch(error){App.notify('保存・削除できませんでした: '+error.message);}
  finally{button.disabled=false;}
}
