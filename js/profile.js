document.getElementById('profileForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('[type=submit]'),status=form.querySelector('.form-status');
  button.disabled=true;status.textContent='保存しています…';
  try{
    await supabaseInitPromise;
    const {data:{user},error:authError}=await window.supabaseClient.auth.getUser();
    if(authError||!user){window.location.href='login.html';return;}
    await App.rpc('save_profile',{p_name:form.fullName.value.trim(),p_school_name:form.schoolName.value.trim(),p_grade:form.grade.value});
    window.location.href='home.html';
  }catch(error){status.textContent='保存できませんでした。'+error.message;}
  finally{button.disabled=false;form.dispatchEvent(new Event('app:complete'));}
});
document.addEventListener('DOMContentLoaded',async()=>{
  try{
    await supabaseInitPromise;
    const {data:{user}}=await window.supabaseClient.auth.getUser();if(!user)return;
    const {data}=await window.supabaseClient.from('profiles').select('name,school_name,grade').eq('id',user.id).maybeSingle();if(!data)return;
    document.getElementById('fullName').value=data.name||'';
    document.getElementById('schoolName').value=data.school_name||'';
    document.getElementById('grade').value=data.grade||'';
  }catch(error){console.error(error);}
});
