"""Capabilities of the document-calculation profile, enforced by the core."""
from engine import CallError

FIELDS={'model','messages','system','max_tokens','tools','tool_choice','stream','thinking',
        'output_config','reasoning_effort','temperature','top_p','top_k','stop_sequences','metadata'}

def validate(payload, model):
    def require(ok):
        if not ok:raise CallError('MODEL_POLICY_CHANGED')
    require(type(payload)is dict and not set(payload)-FIELDS)
    require(payload.get('model')==model and payload.get('stream')is True)
    tools=payload.get('tools',[])
    require(type(tools)is list)
    names=set()
    for tool in tools:
        require(type(tool)is dict and not set(tool)-{'type','name','description','input_schema'})
        require(tool.get('type','custom')=='custom' and tool.get('name')=='run_code')
        require(tool['name']not in names and type(tool.get('input_schema'))is dict)
        names.add(tool['name'])
    choice=payload.get('tool_choice',{'type':'auto'})
    require(type(choice)is dict and not set(choice)-{'type','name','disable_parallel_tool_use'})
    require(choice.get('type')in {'auto','any','none','tool'})
    if 'name'in choice:require(choice['type']=='tool' and choice['name']in names)
    if choice['type']=='tool':require(choice.get('name')in names)
    def blocks(content):
        if type(content)is str:return
        require(type(content)is list)
        for block in content:
            require(type(block)is dict)
            kind=block.get('type')
            require(kind in {'text','thinking','redacted_thinking','tool_use','tool_result'})
            if kind=='tool_use':require(block.get('name')=='run_code')
            if kind=='tool_result':blocks(block.get('content',''))
    messages=payload.get('messages')
    require(type(messages)is list)
    for message in messages:
        require(type(message)is dict and message.get('role')in {'user','assistant'})
        blocks(message.get('content'))
    if 'system'in payload:blocks(payload['system'])
