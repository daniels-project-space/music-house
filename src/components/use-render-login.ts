"use client";
import { useEffect, useState } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
export function useRenderLogin() {
  const [authenticated,setAuthenticated]=useState(false);
  const [ownJobs,setOwnJobs]=useState<Doc<"generationJobs">[]>([]);
  useEffect(()=>{
    const controller=new AbortController();
    const read=async()=>{
      try{
        const session=await fetch("/api/auth/session",{cache:"no-store",signal:controller.signal});
        const value=await session.json();setAuthenticated(value.authenticated===true);
        if(value.authenticated){const response=await fetch("/api/jobs",{cache:"no-store",signal:controller.signal});if(response.ok)setOwnJobs((await response.json()).jobs);}
        else setOwnJobs([]);
      }catch{if(!controller.signal.aborted){setAuthenticated(false);setOwnJobs([]);}}
    };
    void read();const timer=setInterval(()=>{void read();},15_000);
    return()=>{controller.abort();clearInterval(timer);};
  },[]);
  return {authenticated,ownJobs};
}
