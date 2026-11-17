document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form=event.currentTarget, button=form.querySelector('[type=submit]'), status=form.querySelector('.form-status');
  button.disabled=true;status.textContent='ログインしています…';
  try {
    await supabaseInitPromise;
    const {data,error}=await window.supabaseClient.auth.signInWithPassword({email:form.email.value.trim(),password:form.password.value});
    if(error)throw error;
    const {data:profile,error:profileError}=await window.supabaseClient.from('profiles').select('id').eq('id',data.user.id).maybeSingle();
    if(profileError)throw profileError;
    window.location.href=profile?'home.html':'profile.html';
  } catch(error){status.textContent='ログインできませんでした。'+error.message;}
  finally{button.disabled=false;form.dispatchEvent(new Event('app:complete'));}
});
