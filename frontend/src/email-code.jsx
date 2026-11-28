import React,{useState} from "react";
import { api,getCsrf } from "./api";
import { useStore } from "./context";
import { Field,FormError,SubmitButton } from "./components";

export function EmailCodeLogin({onSuccess}){
 const {config,setUser,notify}=useStore();
 const [email,setEmail]=useState(""),[code,setCode]=useState("");
 const [requested,setRequested]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 if(!config.auth?.emailCode?.enabled)return null;
 async function request(e){
  e.preventDefault();setBusy(true);setError("");
  try{const r=await api("/auth/email-code/request",{method:"POST",body:{email}});
   setMessage(r.message);setRequested(true);setCode("");
  }catch(x){setError(x.message)}finally{setBusy(false)}
 }
 async function verify(e){
  e.preventDefault();setBusy(true);setError("");
  try{const r=await api("/auth/email-code/verify",{method:"POST",body:{email,code}});
   await getCsrf(true);setUser(r.user||r);notify("Signed in securely by email OTP.");onSuccess?.();
  }catch(x){setError(x.message)}finally{setBusy(false)}
 }
 return <div className="form-stack" style={{marginTop:"1rem"}}>
  <h3>Sign in with email OTP</h3>
  <p className="muted">Enter the code delivered to your registered customer email. No SMS charge.</p>
  <form className="form-stack" onSubmit={request}>
   <Field label="Email"><input type="email" autoComplete="email" required maxLength={190}
    value={email} onChange={e=>{setEmail(e.target.value);setRequested(false);setCode("")}}/></Field>
   <SubmitButton busy={busy}>Send email OTP</SubmitButton>
  </form>
  {requested&&<form className="form-stack" onSubmit={verify}>
   <p role="status">{message} Code expires after 5 minutes.</p>
   <Field label="Six-digit code"><input value={code} onChange={e=>setCode(e.target.value.replace(/\\D/g,"").slice(0,6))}
    inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></Field>
   <SubmitButton busy={busy}>Verify code and sign in</SubmitButton>
  </form>}
  <FormError error={error}/>
 </div>;
}
