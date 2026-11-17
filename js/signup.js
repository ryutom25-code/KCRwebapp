document.getElementById('signupForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=form.querySelector('[type=submit]'), status=form.querySelector('.form-status');
  button.disabled=true;status.textContent='登録しています…';
  try{
    await supabaseInitPromise;
    const {data,error}=await window.supabaseClient.auth.signUp({email:form.email.value.trim(),password:form.password.value});
    if(error)throw error;
    if(data.session)window.location.href='profile.html';
    else{status.textContent='確認メールを送信しました。メール内のリンクを開いてからログインしてください。';form.querySelector('[type=submit]').textContent='確認メールを再送する';}
  }catch(error){status.textContent='登録できませんでした。'+error.message;}
  finally{button.disabled=false;form.dispatchEvent(new Event('app:complete'));}
});
