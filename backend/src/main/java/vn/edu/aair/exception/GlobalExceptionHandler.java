package vn.edu.aair.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vn.edu.aair.dto.ApiError;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<ApiError> handleAuthException(AuthException exception) {
        return ResponseEntity.status(exception.getStatus())
                .body(ApiError.of(exception.getCode(), exception.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, String> details = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors()
                .forEach(error -> details.putIfAbsent(error.getField(), error.getDefaultMessage()));

        ApiError response = new ApiError(
                false,
                "VALIDATION_ERROR",
                "Dữ liệu không hợp lệ",
                LocalDateTime.now(),
                details
        );

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }

    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleConflict() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("DATA_CONFLICT", "Dữ liệu trùng hoặc đang được sử dụng bởi bản ghi khác"));
    }

    @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
            org.springframework.web.multipart.support.MissingServletRequestPartException.class})
    public ResponseEntity<ApiError> handleBadRequest() {
        return ResponseEntity.badRequest().body(ApiError.of("BAD_REQUEST", "Nội dung yêu cầu không hợp lệ hoặc thiếu trường bắt buộc"));
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> handleUploadSize() {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(ApiError.of("FILE_TOO_LARGE", "Tệp không được vượt quá 50 MB"));
    }

    @ExceptionHandler(java.io.IOException.class)
    public ResponseEntity<ApiError> handleStorage() {
        return ResponseEntity.internalServerError().body(ApiError.of("STORAGE_ERROR", "Không thể đọc hoặc lưu tệp trên máy chủ"));
    }

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleGeneric(Exception exception) {
        log.error("Unhandled exception: ", exception);
        return ResponseEntity.internalServerError().body(ApiError.of("INTERNAL_ERROR", "Đã xảy ra lỗi trên hệ thống. Vui lòng liên hệ quản trị viên."));
    }
}
