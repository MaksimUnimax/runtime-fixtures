"""Incremental SSE framing and durable observation of provider receipts."""
import codecs,json
from model_program_receipts import usage_complete
from model_usage import receipt

class Stream:
    def __init__(self,model,on_receipt=None):
        self.requested_model=model;self.model=model;self.observer=on_receipt
        self.decoder=codecs.getincrementaldecoder('utf-8')()
        self.line='';self.lines=[];self.after_cr=False
        self.billing=None;self.complete=False;self.forbidden=False;self.seen=False

    def feed(self,chunk):
        self.seen=True
        for char in self.decoder.decode(chunk):
            if char=='\n' and self.after_cr:
                self.after_cr=False;continue
            self.after_cr=char=='\r'
            if char in '\r\n':
                if self.line:self.lines.append(self.line)
                else:self.event();self.lines=[]
                self.line=''
            else:self.line+=char

    def event(self):
        data='\n'.join(s[5:].removeprefix(' ') for s in self.lines if s.startswith('data:'))
        if not data:return
        event=json.loads(data)
        if type(event)is not dict:raise ValueError('MODEL_ENVELOPE')
        if event.get('type')=='message_start':
            self.model=event.get('message',{}).get('model',self.model)
        block=event.get('content_block',{})
        if block.get('type')in {'server_tool_use','web_search_tool_result','web_fetch_tool_result'}:
            self.forbidden=True
        if event.get('type')=='message_delta':
            usage=event.get('usage')
            if usage_complete(usage,'/v1/messages'):
                miss,hit,out=(usage[k]for k in ('input_tokens','cache_read_input_tokens','output_tokens'))
                self.billing=receipt({'model':self.model,'usage':{'prompt_tokens':miss+hit,
                  'prompt_cache_hit_tokens':hit,'prompt_cache_miss_tokens':miss,
                  'completion_tokens':out,'total_tokens':miss+hit+out}},self.requested_model)
                extra=usage.get('server_tool_use')
                if extra is not None:
                    self.billing['server_tool_use']={k:v for k,v in extra.items()
                      if type(k)is str and len(k)<=128 and type(v)is int and v>=0} if type(extra)is dict else {}
                    self.forbidden=True
            elif usage is not None:
                # Retain the last valid counters for diagnosis even if a later
                # receipt is malformed; never silently price it as complete.
                self.billing={**(self.billing or {'requested_model':self.requested_model}),'cost_incomplete':True}
        if self.forbidden and self.billing is not None:self.billing['cost_incomplete']=True
        if self.billing is not None and self.observer is not None:self.observer(self.billing)
        if event.get('type')=='message_stop':self.complete=True
