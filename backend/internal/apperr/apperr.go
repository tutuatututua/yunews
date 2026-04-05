// Package apperr defines structured application errors.
package apperr

import "fmt"

// AppError is a safe, user-facing application error.
type AppError struct {
	StatusCode int
	Code       string
	Message    string
	Details    interface{}
}

func (e *AppError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

// New creates an AppError with all fields.
func New(statusCode int, code, message string, details interface{}) *AppError {
	return &AppError{StatusCode: statusCode, Code: code, Message: message, Details: details}
}

// BadRequest returns a 400 error.
func BadRequest(message string) *AppError {
	if message == "" {
		message = "Bad Request"
	}
	return &AppError{StatusCode: 400, Code: "bad_request", Message: message}
}

// NotFound returns a 404 error.
func NotFound(message string) *AppError {
	if message == "" {
		message = "Not Found"
	}
	return &AppError{StatusCode: 404, Code: "not_found", Message: message}
}

// Unauthorized returns a 401 error.
func Unauthorized(message string) *AppError {
	if message == "" {
		message = "Unauthorized"
	}
	return &AppError{StatusCode: 401, Code: "unauthorized", Message: message}
}

// Forbidden returns a 403 error.
func Forbidden(message string) *AppError {
	if message == "" {
		message = "Forbidden"
	}
	return &AppError{StatusCode: 403, Code: "forbidden", Message: message}
}

// Conflict returns a 409 error.
func Conflict(message string) *AppError {
	if message == "" {
		message = "Conflict"
	}
	return &AppError{StatusCode: 409, Code: "conflict", Message: message}
}

// ConflictCode returns a 409 error with a custom code.
func ConflictCode(message, code string) *AppError {
	return &AppError{StatusCode: 409, Code: code, Message: message}
}

// Upstream returns a 502 error.
func Upstream(message string, details interface{}) *AppError {
	if message == "" {
		message = "Upstream Service Error"
	}
	return &AppError{StatusCode: 502, Code: "upstream_error", Message: message, Details: details}
}

// Internal returns a 500 error, hiding the underlying error from the client.
func Internal(_ error) *AppError {
	return &AppError{StatusCode: 500, Code: "internal_error", Message: "An unexpected error occurred"}
}

// Wrap is a helper to wrap a stdlib error as an AppError if it isn't one already.
func Wrap(err error) *AppError {
	if err == nil {
		return nil
	}
	if ae, ok := err.(*AppError); ok {
		return ae
	}
	return Internal(fmt.Errorf("%w", err))
}
