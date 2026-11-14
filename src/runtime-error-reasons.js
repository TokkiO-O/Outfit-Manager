// Outfit Manager · 二改版 | 区分直接事实、可能根因与处理建议
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var RUNTIME_HINTS = ['none', 'api-auth', 'api-quota', 'api-limit', 'api-rate', 'model-missing', 'model-no-images', 'context-limit', 'connection-refused', 'cors', 'csrf', 'storage-denied', 'backup-incomplete'];
export function runtimeErrorHint(text, name, operation) {
    if (/invalid_api_key|invalid api key|authenticationerror/i.test(text)) return 'api-auth';
    if (/insufficient_quota|余额不足|额度不足|账户欠费/i.test(text) && ['api', 'models', 'vision'].includes(operation)) return 'api-quota';
    if (/rate_limit|rate limit|请求过于频繁/i.test(text)) return 'api-rate';
    if (name !== 'QuotaExceededError' && ['api', 'models', 'vision'].includes(operation) && /quota|配额/i.test(text)) return 'api-limit';
    if (/model_not_found|model .*does not exist|模型不存在/i.test(text)) return 'model-missing';
    if (/does not support (?:image|vision)|unsupported.*image|不支持.*(?:图片|视觉)/i.test(text)) return 'model-no-images';
    if (/context_length_exceeded|maximum context length|上下文长度超过/i.test(text)) return 'context-limit';
    if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) return 'connection-refused';
    if (/blocked by CORS|cross-origin request blocked|跨域.*拦截/i.test(text)) return 'cors';
    if (/csrf/i.test(text)) return 'csrf';
    if (name === 'SecurityError' && ['save', 'load', 'startup'].includes(operation)) return 'storage-denied';
    if (/备份内容不完整|备份图片编码不完整/.test(text)) return 'backup-incomplete';
    return 'none';
}
export function explainRuntimeError(entry) {
    var result = { confirmed: '', possible: [], steps: [], relation: '' }, code = entry.code, hint = RUNTIME_HINTS.includes(entry.hint) ? entry.hint : 'none';
    if (code === 'HTTP_ERROR') {
        result.confirmed = '请求收到了 HTTP ' + entry.httpStatus + ' 错误响应；这说明接口或中间服务拒绝或未完成本次请求。';
        var status = entry.httpStatus;
        if (status === 401) { result.possible = ['身份验证未通过，可能是密钥无效、已过期，或请求发往了错误的服务。']; result.steps = ['核对当前接口地址和密钥，确认属于同一服务；不要把密钥发给别人。']; }
        else if (status === 403) { result.possible = ['账号或模型权限、网关限制，或酒馆会话／安全校验未通过。']; result.steps = ['先刷新酒馆重试；再核对模型权限和服务端提示。']; }
        else if (status === 404) { result.possible = ['接口路径、模型或接入点不存在；也可能是代理没有提供这条路由。']; result.steps = ['核对接口路径和模型名称，必要时重新拉取模型列表。']; }
        else if (status === 413) { result.possible = ['图片或请求体超过服务端限制。']; result.steps = ['减少单次图片数量或图片体积后重试。']; }
        else if (status === 429) { result.possible = ['接口限流，或账号额度／并发限制；仅凭 429 不能判断一定是余额不足。']; result.steps = ['降低并发，稍后重试；在服务商后台核对额度及限流说明。']; }
        else if (status >= 500) { result.possible = ['酒馆代理、网关或上游服务内部失败／暂时不可用，当前响应无法单独确定是哪一层。']; result.steps = ['检查对应服务状态和服务端日志，稍后重试；持续出现时导出本日志。']; }
        else { result.possible = ['请求参数、模型限制、认证或中间服务配置不符合接口要求。']; result.steps = ['核对接口与模型设置；结合下方操作位置和服务端日志排查。']; }
    } else if (code === 'API_REJECTED') {
        result.confirmed = '接口调用返回了明确的错误类型标记，日志中没有可确认的 HTTP 错误状态。'; result.possible = ['服务端可能以成功状态或非标准格式返回业务错误，需要按下方标记核对账号、模型或调用限制。']; result.steps = ['检查服务商后台与模型设置；先用单件、小范围测试。'];
    } else if (code === 'QUOTA_EXCEEDED') {
        var browserQuota = entry.name === 'QuotaExceededError';
        result.confirmed = browserQuota ? '浏览器报告存储配额不足，本次写入没有完成。' : '存储操作报告配额限制；只有报错文字，尚不能确认限制发生在浏览器还是配套后端。';
        result.possible = [browserQuota ? '同一酒馆地址下的数据占用过多，或浏览器／WebView 限制了可用存储。' : '站点存储配额、服务端磁盘／存储限制，或上游返回了同类报错。'];
        result.steps = ['先保留衣柜备份，再检查站点存储、设备空间及后端保存状态；不要直接清空衣柜或站点数据。'];
    } else if (code === 'INVALID_STRING_LENGTH' || code === 'OUT_OF_MEMORY') {
        result.confirmed = code === 'INVALID_STRING_LENGTH' ? '创建或拼接字符串时超过了当前引擎可接受的大小。' : '运行环境报告可用内存不足。'; result.possible = ['大备份、内嵌图片或重复序列化使单次数据／内存开销过大；不是衣服重名导致。']; result.steps = ['保留原文件，分批导入；记录失败阶段、文件大小和扩展版本后导出报告。'];
    } else if (code === 'INVALID_JSON') {
        result.confirmed = '解析或校验数据时失败，当前内容不能作为有效的 JSON／完整备份继续处理。'; result.possible = ['文件不完整、下载被截断、选错文件，或数据格式与当前版本不兼容。']; result.steps = ['重新取得原始 JSON，保留原文件；不要直接覆盖原衣柜。'];
    } else if (code === 'SCRIPT_SYNTAX_ERROR') {
        result.confirmed = '浏览器无法解析相关 JavaScript 代码。'; result.possible = ['脚本文件损坏、缓存版本混用，或当前浏览器不支持所用语法。']; result.steps = ['完整刷新／重启；确认扩展文件更新完整，再检查下方文件位置。'];
    } else if (code === 'UNDEFINED_PROPERTY' || code === 'NULL_PROPERTY' || code === 'NOT_FUNCTION' || code === 'NOT_DEFINED') {
        result.confirmed = code === 'UNDEFINED_PROPERTY' ? '代码访问属性时，对象仍是 undefined。' : code === 'NULL_PROPERTY' ? '代码访问属性时，对象是 null。' : code === 'NOT_FUNCTION' ? '代码尝试调用的值不是可执行函数。' : '代码引用了当前作用域中不存在的变量。';
        result.possible = ['初始化或聊天切换尚未完成、数据结构不符合预期、扩展自身缺陷，或外部代码改变了接口。']; result.steps = ['等待加载完成后复试；保留下方文件行列和操作步骤。若仍能复现，使用兼容性检查做停用前后对照。'];
    } else if (code === 'CALL_STACK_LIMIT') {
        result.confirmed = '同步调用层数超过了引擎限制。'; result.possible = ['函数递归没有结束，或多层拦截器相互调用形成循环。']; result.steps = ['查看下方是否出现重复的模块／关联扩展，再做停用前后对照；不要仅凭调用栈出现扩展名就认定冲突。'];
    } else if (code === 'INVALID_ARRAY_LENGTH') {
        result.confirmed = '代码尝试创建非法长度的数组。'; result.possible = ['数量计算错误或输入结构超出预期。']; result.steps = ['保留文件位置和复现步骤反馈维护者。'];
    } else if (code === 'CIRCULAR_JSON') {
        result.confirmed = '待序列化的对象存在循环引用，无法直接转换为 JSON。'; result.possible = ['程序把运行时对象或重复互相引用的对象加入了待保存数据。']; result.steps = ['导出日志并保留操作步骤；这通常需要修改代码，反复重试不能修复对象结构。'];
    } else if (code === 'SAVE_CONFLICT') {
        result.confirmed = '保存时检测到版本不一致，已按冲突处理。'; result.possible = ['多个窗口／设备同时修改，或远端数据已经更新。']; result.steps = ['到保存状态查看并处理冲突，先核对两边数据，避免盲目覆盖。'];
    } else if (code === 'REQUEST_TIMEOUT' || code === 'NETWORK_FAILED') {
        result.confirmed = code === 'REQUEST_TIMEOUT' ? '请求在等待期限内没有完成。' : '请求没有成功取得可用响应。'; result.possible = ['网络、服务地址、代理、上游服务或浏览器策略异常；仅凭连接失败不能确定具体一层。']; result.steps = ['检查接口／后端是否正在运行及地址是否正确；再核对网络和服务端日志。'];
    } else if (code === 'API_EMPTY_RESULT' || code === 'API_RESULT_INVALID') {
        result.confirmed = code === 'API_EMPTY_RESULT' ? '接口返回了空内容。' : '返回内容未提供可用的服装描述，原有描述已保留。'; result.possible = ['模型未按格式回答、模型不支持图片、接口截断了输出，或提示词与模型不匹配。']; result.steps = ['核对模型是否支持图片；先用单件测试，并检查自定义提示词的输出格式。'];
    } else if (code === 'SCRIPT_LOAD_FAILED') {
        result.confirmed = '穿搭相关脚本或样式资源没有加载成功。'; result.possible = ['文件缺失、缓存混用、请求被拦截，或安装目录不完整。']; result.steps = ['完整更新同一扩展副本并重启；检查下方资源文件位置。'];
    } else if (code === 'DB_TRANSACTION_FAILED' || code === 'PARTITION_READ_FAILED' || code === 'IMAGE_READ_FAILED') {
        result.confirmed = code === 'PARTITION_READ_FAILED' ? '衣柜分区读取没有成功，当前结果不能作为有效衣柜继续使用。' : code === 'IMAGE_READ_FAILED' ? '图片读取或编码校验失败。' : '本地存储操作或事务没有成功完成。'; result.possible = ['数据／图片缺失或损坏、存储权限或配额、事务中止；当前分类不足以确定唯一根因。']; result.steps = ['保留原备份，查看保存状态和存储检测；不要先清空原衣柜。'];
    } else {
        result.confirmed = '该操作记录到了异常，但现有证据不足以确定错误机制。'; result.possible = ['需要结合文件位置、发生时的操作及对照检测继续定位。']; result.steps = ['开启复现记录重做一次，再导出日志与兼容性报告。'];
    }
    var hints = {
        'api-auth': ['错误响应含身份验证失败标记。', '核对服务地址及密钥有效性；不要在反馈中提供密钥。'],
        'api-quota': ['错误响应含额度／余额不足标记。', '到服务商后台核对账号额度和账户状态。'],
        'api-limit': ['接口错误提示中出现配额限制，不能据此判断是余额、次数还是模型额度。', '核对服务商的账号额度、调用次数和模型限制。'],
        'api-rate': ['错误响应含请求速率限制标记。', '降低并发并等待限流窗口结束。'],
        'model-missing': ['错误响应含模型不存在标记。', '核对模型名称或接入点，重新拉取可用模型。'],
        'model-no-images': ['错误响应表明当前模型不支持这类图片输入。', '换用支持图片输入的模型后先测试单件。'],
        'context-limit': ['错误响应含上下文长度超限标记。', '减少单次内容或图片数量，缩短提示词。'],
        'connection-refused': ['连接被拒绝，目标服务未接受连接。', '检查服务是否启动、端口和地址是否正确。'],
        cors: ['浏览器报告跨域访问被阻止。', '优先使用酒馆代理，或由接口服务正确配置跨域访问。'],
        csrf: ['错误响应含酒馆安全校验失败标记。', '刷新酒馆重新建立会话后再试。'],
        'storage-denied': ['浏览器拒绝了这次存储访问。', '检查站点存储权限及 WebView／隐私模式限制。'],
        'backup-incomplete': ['文件处理器报告备份／图片内容不完整。', '重新获取完整文件，核对文件大小后再试。']
    };
    if (hint !== 'none') { result.confirmed += ' ' + hints[hint][0]; result.steps.unshift(hints[hint][1]); }
    result.relation = entry.related && entry.related.length ? '调用栈中出现了其他扩展／后端插件，见关联位置。出现于调用栈只说明参与调用，不能单独证明它造成错误。' : '当前错误没有可直接归因到其他扩展的证据；请勿仅凭这条日志判断扩展冲突。';
    return result;
}
