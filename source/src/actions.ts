import {toQuantity,AbiCoder,Interface} from 'ethers';
import {CHAIN,ROUTER,receivedNet,PendingStore} from './core';
import type {Engine,Quote,ReadRPC} from './engine';
export async function submitConfirmed(e:Engine,q:Quote,generation:number,input:string,approvedCost:bigint,current:()=>boolean){
 if(e.pending.read())throw Error('存在未核对交易');
 const prepared=await e.prepare(q,generation,input);
 if(prepared.maxCost>approvedCost)throw Error('费用上限增加，请重新确认');
 if(!current())throw Error('输入或钱包已变化');
 await e.fresh(q,generation,input);
 if(!current())throw Error('输入或钱包已变化');
 return e.pending.send({kind:q.kind||'buy',amount:q.amount.toString(),target:q.kind==='approve'?q.token:ROUTER,account:q.account,token:q.token,data:q.data,value:q.kind==='sell'||q.kind==='approve'?'0x0':toQuantity(q.amount),min:q.min.toString(),decimals:q.decimals,nonce:prepared.nonce},()=>e.wallet.request({method:'eth_sendTransaction',params:[prepared.tx]}));
}
export async function reconcile(store:PendingStore,read:ReadRPC,manualHash?:string):Promise<{kind:string;hash?:string;net?:bigint}>{
 const p=store.read();if(!p)return {kind:'idle'};
 const hash=manualHash||p.hash;if(!hash)return {kind:'unknown'};
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('交易哈希格式错误');
 if(String(await read('eth_chainId',[])).toLowerCase()!==CHAIN)throw Error('RPC 网络不匹配');
 const tx=await read('eth_getTransactionByHash',[hash]);if(!tx)return {kind:'pending',hash};
 // Keep the v1 storage key: old pending intent must never disappear on upgrade.
 const legacy='0x000000008226d8990aa931d7f449c2012b4b9522';
 const target=p.target===undefined&&String(p.data).toLowerCase().startsWith('0x4bac0037')?legacy:String(p.target).toLowerCase();
 if(p.kind==='approve'?target!==String(p.token).toLowerCase():![ROUTER,legacy].includes(target))throw Error('待处理目标无法识别或不匹配：保持锁定，请人工核对');
 if(String(tx.from).toLowerCase()!==String(p.account).toLowerCase()||String(tx.to).toLowerCase()!==target||String(tx.input).toLowerCase()!==String(p.data).toLowerCase()||BigInt(tx.value)!==BigInt(String(p.value)))throw Error('交易与待处理记录不匹配');
 if(manualHash)store.write({...p,hash,phase:'sent'});
 const receipt=await read('eth_getTransactionReceipt',[hash]);if(!receipt)return {kind:'pending',hash};
 const height=BigInt(await read('eth_blockNumber',[]));if(height-BigInt(receipt.blockNumber)+1n<3n)return {kind:'confirming',hash};
 if(receipt.status==='0x0'){store.clear();return {kind:'reverted',hash};}
 if(receipt.status!=='0x1')return {kind:'unknown',hash};
 if(p.kind==='approve'){const data=new Interface(['function allowance(address,address) view returns(uint256)']).encodeFunctionData('allowance',[p.account,ROUTER]);const allowance=BigInt(AbiCoder.defaultAbiCoder().decode(['uint256'],await read('eth_call',[{to:p.token,data},'latest']))[0]);if(allowance<BigInt(String(p.amount)))return {kind:'approval-unverified',hash};store.clear();return {kind:'approved',hash};}
 const net=receivedNet(receipt.logs,String(p.token),String(p.account));
 if(p.kind==='sell'){store.clear();return {kind:net===-BigInt(String(p.amount))?'sell-native-unverified':'sell-debit-unverified',hash,net};}
 store.clear();return {kind:net>0n?'success':'no-arrival',hash,net};
}
