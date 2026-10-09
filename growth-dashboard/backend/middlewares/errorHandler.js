/**
 * Error Handler Middleware
 * 统一错误处理
 */

// 错误类型分类
const ErrorTypes = {
    VALIDATION: 'VALIDATION_ERROR',
    AUTH: 'AUTH_ERROR',
    NOT_FOUND: 'NOT_FOUND_ERROR',
    DATABASE: 'DATABASE_ERROR',
    BUSINESS: 'BUSINESS_ERROR',
    SYSTEM: 'SYSTEM_ERROR'
};

// 错误码映射
const ErrorCodes = {
    // 验证错误 400
    'invalid_input': { status: 400, message: '输入格式无效' },
    'missing_field': { status: 400, message: '缺少必填字段' },

    // 认证错误 401
    'unauthorized': { status: 401, message: '请先登录' },
    'token_expired': { status: 401, message: '登录已过期，请重新登录' },
    'invalid_token': { status: 401, message: '无效的登录凭证' },

    // 权限错误 403
    'forbidden': { status: 403, message: '权限不足' },
    'cors_blocked': { status: 403, message: '不允许的请求来源' },

    // 资源错误 404
    'not_found': { status: 404, message: '资源不存在' },
    'user_not_found': { status: 404, message: '用户不存在' },

    // 业务错误 422
    'duplicate': { status: 422, message: '资源已存在' },
    'invalid_operation': { status: 422, message: '操作无效' },

    // 系统错误 500
    'database_error': { status: 500, message: '数据库错误' },
    'internal_error': { status: 500, message: '服务器内部错误' }
};

const errorHandler = (err, req, res, next) => {
    // 获取请求信息用于日志
    const requestInfo = {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userId: req.user?.id || 'anonymous'
    };

    // 处理 body-parser 错误
    if (err && err.type === 'entity.too.large') {
        console.warn(`[${new Date().toISOString()}] File too large:`, requestInfo);
        return res.status(413).json({
            error: '上传文件过大，请压缩后重试（建议不超过 8MB）',
            code: 'file_too_large'
        });
    }

    // 处理 JSON 解析错误
    if (err && err.type === 'entity.parse.failed') {
        console.warn(`[${new Date().toISOString()}] Parse error:`, requestInfo);
        return res.status(400).json({
            error: '请求格式错误，请检查 JSON 格式',
            code: 'parse_error'
        });
    }

    // 处理 CORS 错误
    if (err && err.message === 'Not allowed by CORS') {
        console.warn(`[${new Date().toISOString()}] CORS blocked:`, requestInfo);
        return res.status(403).json({
            error: '不允许的请求来源',
            code: 'cors_blocked'
        });
    }

    // 处理验证错误
    if (err && err.name === 'ValidationError') {
        return res.status(400).json({
            error: '输入验证失败',
            code: 'validation_error',
            details: err.details || err.message
        });
    }

    // 处理数据库错误 (PostgreSQL/Supabase)
    if (err && err.code) {
        const dbErrorMap = {
            '23505': { status: 409, message: '数据已存在，请勿重复提交' },
            '23503': { status: 400, message: '关联数据不存在' },
            '23502': { status: 400, message: '缺少必填字段' },
            '22P02': { status: 400, message: '数据格式无效' },
            'P0001': { status: 400, message: err.message || '数据库操作失败' }
        };

        const dbError = dbErrorMap[err.code];
        if (dbError) {
            console.error(`[${new Date().toISOString()}] DB Error (${err.code}):`, err.message, requestInfo);
            return res.status(dbError.status).json({
                error: dbError.message,
                code: 'database_error'
            });
        }
    }

    // 自定义错误码处理
    if (err && err.errorCode && ErrorCodes[err.errorCode]) {
        const mappedError = ErrorCodes[err.errorCode];
        return res.status(mappedError.status).json({
            error: err.customMessage || mappedError.message,
            code: err.errorCode
        });
    }

    // 默认错误处理 - 记录详细日志
    console.error(`[${new Date().toISOString()}] Unhandled error:`, {
        message: err.message,
        stack: err.stack,
        request: requestInfo
    });

    res.status(err.status || 500).json({
        error: err.message || '服务器内部错误',
        code: 'internal_error'
    });
};

// 自定义错误类
class AppError extends Error {
    constructor(message, errorCode, status = 500) {
        super(message);
        this.errorCode = errorCode;
        this.status = status;
    }
}

module.exports = errorHandler;
module.exports.ErrorTypes = ErrorTypes;
module.exports.AppError = AppError;
