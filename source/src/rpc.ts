const endpoints=['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com','https://robinhood.drpc.org'];
const methods=new Set(['eth_chainId','eth_blockNumber','eth_getStorageAt','eth_getCode','eth_call','eth_estimateGas','eth_getBlockByNumber','eth_gasPrice','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt']);
export async function readRpc(method:string,params:any[],fetcher:typeof fetch=fetch):Promise<any>{
 if(!methods.has(method))throw Error('只读 RPC 禁止此方法；交易只能由钱包确认发送');
 const failures:string[]=[];
 for(const endpoint of endpoints){
  try{
   const exchange=async(m:string,p:any[])=>{const r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();if(d?.jsonrpc!=='2.0'||d.id!==1||('result' in d)===('error' in d))throw Error('无效RPC响应');return d;};
   const id=await exchange('eth_chainId',[]);if(id.error)throw Error('链验证失败');if(String(id.result).toLowerCase()!=='0x1237')throw Error('网络不匹配，需要Robinhood主网');
   const d=method==='eth_chainId'?id:await exchange(method,params);
   if(d.error){const e:any=new Error(d.error.message||'RPC错误');e.application=true;e.code=d.error.code;const raw=d.error.data;const revert=typeof raw==='string'?raw:raw?.data;if(method==='eth_call'&&typeof revert==='string'&&/^0x[0-9a-f]*$/i.test(revert)){e.code='CALL_EXCEPTION';e.data=revert;}throw e;}
   return d.result;
  }catch(e){if((e as any)?.application)throw e;failures.push(new URL(endpoint).hostname+': '+((e as Error).message||'网络连接失败'));}
 }
 throw Error('只读RPC不可用（可能网络或跨域限制）：'+failures.join('；'));
}
