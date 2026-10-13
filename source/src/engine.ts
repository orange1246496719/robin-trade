import { AbiCoder, Interface, ZeroAddress, parseUnits, getAddress, toQuantity, keccak256 } from 'ethers';
import {encodeSell,searchNativeOutput} from './core';
export const erc20=new Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
import {CHAIN,ROUTER,IMPLEMENTATION,SLOT,parseInputs,encodeBuy,searchOutput,protectedMinimum,checkImplementation,isFresh,PendingStore,type FreshQuote} from './core';
export type ReadRPC=(method:string,params:any[])=>Promise<any>;
export type Wallet={request:(args:{method:string;params?:any[]})=>Promise<any>;on?:(event:string,fn:(...args:any[])=>void)=>void;removeListener?:(event:string,fn:(...args:any[])=>void)=>void};
export type Quote=FreshQuote&{kind?:'buy'|'sell'|'approve';target?:string;token:string;amount:bigint;bps:number;low:bigint;min:bigint;decimals:number;data:string;block:string;calls:number};
export type Prepared={tx:Record<string,string>;maxCost:bigint;maxFee:bigint;gas:bigint;nonce:string};
export class Engine {
 constructor(public read:ReadRPC,public wallet:Wallet,public pending:PendingStore){}
 async identity(){const accounts=await this.wallet.request({method:'eth_accounts'});const chain=String(await this.wallet.request({method:'eth_chainId'})).toLowerCase();if(!accounts?.[0])throw Error('请先连接钱包');if(chain!==CHAIN)throw Error('请单独切换至 Robinhood 主网');return {account:getAddress(accounts[0]),chain};}
 async network(){if(String(await this.read('eth_chainId',[])).toLowerCase()!==CHAIN)throw Error('公共 RPC 链 ID 不匹配');}
 async implementation(block:string){
 // Observed ERC-1967 delegatecall proxy, pinned at block 0x5335762.
 const proxyCode=await this.read('eth_getCode',[ROUTER,block]);
 if(typeof proxyCode!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(proxyCode)||keccak256(proxyCode)!=='0x124781bc5ba986358f7155287ed3f102fefa10955f1665d795d6c5b5f3cb53f8')throw Error('路由器代理代码已变化或无法验证：停止');
 checkImplementation(await this.read('eth_getStorageAt',[ROUTER,SLOT,block]));
 const implementationCode=await this.read('eth_getCode',[IMPLEMENTATION,block]);
 if(typeof implementationCode!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(implementationCode)||keccak256(implementationCode)!=='0x31ff5ddeccd1d756671a03e3bc59c81a974fcba82256c8624ec5370e93708b7a')throw Error('路由器实现代码已变化或无法验证：停止');
 }
 async quote(ca:string,amount:string,slippage:string,generation:number,progress?:(n:number)=>void):Promise<Quote>{
 if(this.pending.read())throw Error('存在未核对交易：禁止新交易');
 const parsed=parseInputs(ca,amount,slippage);const identity=await this.identity();await this.network();
 const block=await this.read('eth_blockNumber',[]);if(!/^0x[0-9a-f]+$/i.test(block))throw Error('无法固定区块');
 await this.implementation(block);
 const code=await this.read('eth_getCode',[parsed.token,block]);if(!code||code==='0x')throw Error('CA 在该区块没有合约代码');
 const coder=AbiCoder.defaultAbiCoder();
 const tokenCall=(data:string)=>this.read('eth_call',[{to:parsed.token,data},block]);
 const supply=BigInt(coder.decode(['uint256'],await tokenCall('0x18160ddd'))[0]);
 const decimals=Number(coder.decode(['uint8'],await tokenCall('0x313ce567'))[0]);
 const result=await searchOutput(supply,min=>this.read('eth_call',[{from:identity.account,to:ROUTER,data:encodeBuy(parsed.token,parsed.amount,min),value:toQuantity(parsed.amount)},block]),progress);
 const min=protectedMinimum(result.low,parsed.bps);
 const end=await this.identity();if(end.account!==identity.account||end.chain!==identity.chain)throw Error('模拟期间钱包已变化，结果作废');
 return {...identity,generation,input:[ca,amount,slippage].join('|'),created:Date.now(),...parsed,...result,min,decimals,data:encodeBuy(parsed.token,parsed.amount,min),block};
 }
 async tokenState(ca:string,account:string,block:string){
 const token=getAddress(ca.trim());if(token===ZeroAddress)throw Error('零地址');if(await this.read('eth_getCode',[token,block])==='0x')throw Error('代币无代码');
 const call=async(data:string)=>BigInt(AbiCoder.defaultAbiCoder().decode(['uint256'],await this.read('eth_call',[{to:token,data},block]))[0]);
 const decimals=Number(await call('0x313ce567'));if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('代币 decimals 无法安全支持');
 return {token,decimals,balance:await call(erc20.encodeFunctionData('balanceOf',[account])),allowance:await call(erc20.encodeFunctionData('allowance',[account,ROUTER]))};
 }
 async sellContext(ca:string,amount:string){if(this.pending.read())throw Error('存在未核对交易');const identity=await this.identity();await this.network();const block=await this.read('eth_blockNumber',[]);if(!/^0x[0-9a-f]+$/i.test(block))throw Error('无法固定区块');await this.implementation(block);const s=await this.tokenState(ca,identity.account,block);if(!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount.trim()))throw Error('代币数量必须普通十进制');const raw=parseUnits(amount.trim(),s.decimals);if(raw<=0n||raw>s.balance)throw Error('代币数量无效或余额不足');return {...identity,...s,block,amount:raw};}
 async approvalQuote(ca:string,amount:string,generation:number):Promise<Quote>{const s=await this.sellContext(ca,amount);if(s.allowance>=s.amount)throw Error('授权已充足，请直接重新模拟卖出');if(s.allowance!==0n)throw Error('现有非零授权不足：请在钱包中撤销后重试，不自动归零');return {...s,generation,kind:'approve',target:s.token,created:Date.now(),input:['approve',ca,amount].join('|'),bps:0,low:0n,min:0n,calls:0,data:erc20.encodeFunctionData('approve',[ROUTER,s.amount])};}
 async quoteSell(ca:string,amount:string,slippage:string,generation:number,progress?:(n:number)=>void):Promise<Quote>{const s=await this.sellContext(ca,amount);if(s.allowance<s.amount)throw Error('授权不足：先单独确认精确授权，确认后重新模拟卖出');const {bps}=parseInputs(ca,'1',slippage);const r=await searchNativeOutput(min=>this.read('eth_call',[{from:s.account,to:ROUTER,value:'0x0',data:encodeSell(s.token,s.amount,min)},s.block]),progress);const min=protectedMinimum(r.low,bps);const end=await this.identity();if(end.account!==s.account||end.chain!==s.chain)throw Error('钱包变化');return {...s,...r,kind:'sell',generation,created:Date.now(),input:['sell',ca,amount,slippage].join('|'),bps,min,data:encodeSell(s.token,s.amount,min)};}
 async fresh(q:Quote,generation:number,input:string){const identity=await this.identity();if(!isFresh(q,{...identity,generation,input,now:Date.now()}))throw Error('报价已失效，请重新模拟');if(this.pending.read())throw Error('存在未核对交易');}
 async prepare(q:Quote,generation:number,input:string):Promise<Prepared>{
 await this.fresh(q,generation,input);await this.network();await this.implementation('latest');
 const value=q.kind==='sell'||q.kind==='approve'?0n:q.amount;
 if(q.kind==='sell'||q.kind==='approve'){const s=await this.tokenState(q.token,q.account,'latest');if(s.decimals!==q.decimals||s.balance<q.amount)throw Error('代币余额或 decimals 已变化');if(q.kind==='sell'&&s.allowance<q.amount)throw Error('授权不足');if(q.kind==='approve'&&s.allowance!==0n)throw Error('授权状态变化，重新核对');}
 const protectedTx={from:q.account,to:q.kind==='approve'?q.token:ROUTER,value:toQuantity(value),data:q.data};
 await this.read('eth_call',[protectedTx,'latest']);
 const estimate=BigInt(await this.read('eth_estimateGas',[protectedTx]));if(estimate<=0n)throw Error('Gas 估算无效');
 const gas=(estimate*120n+99n)/100n;
 const block=await this.read('eth_getBlockByNumber',['latest',false]);
 const gasPrice=BigInt(await this.read('eth_gasPrice',[]));if(gasPrice<=0n)throw Error('Gas 价格无效');
 let maxFee:bigint;let fees:Record<string,string>;
 if(block?.baseFeePerGas!=null){const tip=BigInt(await this.read('eth_maxPriorityFeePerGas',[]));maxFee=BigInt(block.baseFeePerGas)*2n+tip;if(maxFee<gasPrice*2n)maxFee=gasPrice*2n;fees={maxFeePerGas:toQuantity(maxFee),maxPriorityFeePerGas:toQuantity(tip)};}else{maxFee=gasPrice*2n;fees={gasPrice:toQuantity(maxFee)};}
 const maxCost=value+gas*maxFee;
 const balance=BigInt(await this.read('eth_getBalance',[q.account,'latest']));if(balance<maxCost)throw Error('ETH 余额不足以覆盖数量与保守 Gas 上限');
 const nonce=await this.read('eth_getTransactionCount',[q.account,'pending']);
 await this.fresh(q,generation,input);
 return {tx:{...protectedTx,...fees,gas:toQuantity(gas),chainId:CHAIN},gas,maxFee,maxCost,nonce};
 }
}
