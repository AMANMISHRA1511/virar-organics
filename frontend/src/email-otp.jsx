import React, { useState } from "react";
import { api, getCsrf } from "./api";
import { useStore } from "./context";
import { Field, FormError, SubmitButton } from "./components";

export function EmailOtpLogin({ onSuccess }) {
 const { config, setUser, notify }=useStore();
 const [email,setEmail]=useState(""),[code,setCode]=useState("");
 const [requested,setRequested]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 if(!config.auth?.emailOtp?.enabled)return null;
 async function request(event){
  event.preventDefault();setBusy(true);setError("");
  try{const result=await api("/auth/email-otp/request",{method:"POST",body:{email}});
   setMessage(result.message);setRequested(true);setCode("");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function verify(event){
  event.preventDefault();setBusy(true);setError("");
  try{const result=await api("/auth/email-otp/verify",{method:"POST",body:{email,code}});
   await getCsrf(true);setUser(result.user||result);notify("Signed in using email OTP.");onSuccess?.();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="form-stack" style={{marginTop:"1rem"}}>
  <h3>Sign in with email OTP</h3>
  <p className="muted">Get a six-digit sign-in code at your registered customer email. No SMS charge.</p>
  <form className="form-stack" onSubmit={request}>
   <Field label="Registered email"><input type="email" autoComplete="email" maxLength={190} required value={email}
    onChange={e=>{setEmail(e.target.value);setRequested(false);setCode("");}} /></Field>
   <SubmitButton busy={busy}>Send email OTP</SubmitButton>
  </form>
  {requested&&<form className="form-stack" onSubmit={verify}>
   <p role="status">{message} Code expires in five minutes.</p>
   <Field label="Six-digit OTP"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
    minLength={6} maxLength={6} required value={code}
    onChange={e=>setCode(e.target.value.replace(/\\D/g,"").slice(0,6))}/></Field>
   <SubmitButton busy={busy}>Verify and sign in</SubmitButton>
  </form>}
  <FormError error={error}/>
 </div>;
}
