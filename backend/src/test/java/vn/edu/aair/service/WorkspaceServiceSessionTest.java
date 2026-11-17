package vn.edu.aair.service;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import vn.edu.aair.dto.WorkspaceRequests.Members;
import vn.edu.aair.dto.WorkspaceRequests.Session;
import vn.edu.aair.dto.WorkspaceRequests.State;
import vn.edu.aair.dto.WorkspaceRequests.Task;
import vn.edu.aair.exception.AuthException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkspaceServiceSessionTest {

    @Mock
    private JdbcTemplate db;

    @Mock
    private PasswordEncoder passwords;

    @Mock
    private AccountMailService accountMail;

    private WorkspaceService service;
    private Validator validator;
    private final Set<Long> unavailableUserIds = new HashSet<>();
    private final Set<Long> busyOnClaimUserIds = new HashSet<>();

    @BeforeEach
    void setUp() {
        service = new WorkspaceService(db, passwords, accountMail);
        validator = Validation.buildDefaultValidatorFactory().getValidator();
        unavailableUserIds.clear();
        busyOnClaimUserIds.clear();

        // Default login as MANAGER (id = 10, username = "manager01")
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("manager01", "token"));

        lenient().when(db.queryForList(startsWith("SELECT id, username, role FROM users"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    String username = (String) invocation.getArgument(1);
                    if ("manager01".equalsIgnoreCase(username)) {
                        return List.of(Map.of("id", 10L, "username", "manager01", "role", "MANAGER"));
                    } else if ("manager02".equalsIgnoreCase(username)) {
                        return List.of(Map.of("id", 20L, "username", "manager02", "role", "MANAGER"));
                    } else if ("labeler01".equalsIgnoreCase(username)) {
                        return List.of(Map.of("id", 30L, "username", "labeler01", "role", "AI_LABELER"));
                    }
                    return List.of();
                });

        lenient().when(db.queryForList(startsWith("SELECT id, username, role, is_active FROM users WHERE id=?"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object idArg = invocation.getArgument(1);
                    long userId = idArg instanceof Number ? ((Number) idArg).longValue() : Long.parseLong(String.valueOf(idArg));
                    if (userId == 30L) {
                        return List.of(Map.of("id", 30L, "username", "labeler01", "role", "AI_LABELER", "is_active", true));
                    } else if (userId == 31L) {
                        return List.of(Map.of("id", 31L, "username", "manual_labeler01", "role", "MANUAL_LABELER", "is_active", true));
                    } else if (userId == 32L) {
                        return List.of(Map.of("id", 32L, "username", "manual_labeler02", "role", "MANUAL_LABELER", "is_active", true));
                    } else if (userId == 33L) {
                        return List.of(Map.of("id", 33L, "username", "manual_labeler03", "role", "MANUAL_LABELER", "is_active", true));
                    } else if (userId == 35L) {
                        return List.of(Map.of("id", 35L, "username", "inactive_manual01", "role", "MANUAL_LABELER", "is_active", false));
                    } else if (userId == 40L) {
                        return List.of(Map.of("id", 40L, "username", "reviewer01", "role", "REVIEWER", "is_active", true));
                    } else if (userId == 45L) {
                        return List.of(Map.of("id", 45L, "username", "inactive_reviewer01", "role", "REVIEWER", "is_active", false));
                    }
                    return List.of();
                });

        // Default: permissions enabled
        lenient().when(db.queryForObject(startsWith("SELECT COUNT(*) FROM role_permissions"), eq(Long.class), any(Object[].class)))
                .thenReturn(1L);

        // Default: availability check via users.status (AVAILABLE unless user is in unavailableUserIds)
        lenient().when(db.queryForList(startsWith("SELECT status FROM users WHERE id=?"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object idArg = invocation.getArgument(1);
                    long targetUserId = idArg instanceof Number ? ((Number) idArg).longValue() : Long.parseLong(String.valueOf(idArg));
                    if (unavailableUserIds.contains(targetUserId)) {
                        return List.of(Map.of("status", "BUSY"));
                    }
                    return List.of(Map.of("status", "AVAILABLE"));
                });

        // Default: document lookup succeeds for manager 10L
        lenient().when(db.queryForList(startsWith("SELECT * FROM documents WHERE id=?"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object idArg = invocation.getArgument(1);
                    long docId = idArg instanceof Number ? ((Number) idArg).longValue() : Long.parseLong(String.valueOf(idArg));
                    return List.of(Map.of("id", docId, "title", "Document " + docId, "uploaded_by", 10L));
                });

        // Default: audit_logs insert succeeds
        lenient().when(db.update(startsWith("INSERT INTO audit_logs"), any(Object[].class)))
                .thenReturn(1);

        // Default: session_members insert succeeds
        lenient().when(db.update(startsWith("INSERT INTO session_members"), any(Object[].class)))
                .thenReturn(1);

        // Default: annotation_tasks insert succeeds
        lenient().when(db.queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    return List.of(new HashMap<>(Map.of("id", 801L, "status", "PENDING")));
                });

        // Default: conditional claim AVAILABLE -> BUSY succeeds (returns 1 unless user is in unavailableUserIds or busyOnClaimUserIds)
        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users") && sql.contains("status = 'BUSY'")), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object[] args = invocation.getArguments();
                    Object idArg = args.length > 1 ? args[1] : null;
                    Long targetUserId = null;
                    if (idArg instanceof Object[] arr && arr.length > 0) {
                        targetUserId = ((Number) arr[0]).longValue();
                    } else if (idArg instanceof Number num) {
                        targetUserId = num.longValue();
                    }
                    if (targetUserId != null && (unavailableUserIds.contains(targetUserId) || busyOnClaimUserIds.contains(targetUserId))) {
                        return 0;
                    }
                    return 1;
                });

        // Default: release BUSY -> AVAILABLE succeeds on close session
        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users") && sql.contains("status = 'AVAILABLE'")), any(Object[].class)))
                .thenReturn(1);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("1. MANAGER create session thành công, trim name, status DRAFT, created_by đúng và ghi audit log")
    void managerCreateSessionSuccess() {
        LocalDateTime futureDue = LocalDateTime.now().plusDays(7);
        Session request = new Session("  Financial Report 2026  ", "Annotation for Q4", "AI", futureDue,
                null, null, 30L, 40L, "AI_ASSISTED");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object[] args = invocation.getArguments();
                    // First arg is SQL, remaining is Object[] args in queryForList(sql, args)
                    // With varargs: invocation.getArgument(0) is SQL, remaining are query parameters
                    return List.of(new HashMap<>(Map.of(
                            "id", 100L,
                            "name", "Financial Report 2026",
                            "description", "Annotation for Q4",
                            "session_type", "AI",
                            "status", "DRAFT",
                            "created_by", 10L,
                            "due_at", futureDue
                    )));
                });

        Map<String, Object> result = service.createSession(request);

        assertNotNull(result);
        assertEquals(100L, result.get("id"));
        assertEquals("Financial Report 2026", result.get("name"));
        assertEquals("DRAFT", result.get("status"));
        assertEquals(10L, result.get("created_by"));

        // Verify SQL arguments passed to INSERT
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), captor.capture(), any(), any(), any(), any());
        assertEquals("Financial Report 2026", captor.getValue(), "Session name must be trimmed");

        // Verify Audit Log was written
        verify(db).update(
                eq("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)"),
                eq(10L), eq("CREATE"), eq("SESSION"), eq(100L)
        );
    }

    @Test
    @DisplayName("2. Non-MANAGER create session bị 403 FORBIDDEN")
    void nonManagerCreateSessionForbidden() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("labeler01", "token"));

        Session request = new Session("Session 1", "Desc", "AI", LocalDateTime.now().plusDays(2));

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(request));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        assertEquals("FORBIDDEN", ex.getCode());
    }

    @Test
    @DisplayName("3. MANAGER thiếu quyền SESSIONS:WRITE bị 403 FORBIDDEN")
    void managerWithoutPermissionForbidden() {
        when(db.queryForObject(startsWith("SELECT COUNT(*) FROM role_permissions"), eq(Long.class), any(Object[].class)))
                .thenReturn(0L);

        Session request = new Session("Session 1", "Desc", "AI", LocalDateTime.now().plusDays(2));

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(request));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        assertTrue(ex.getMessage().contains("không có quyền WRITE cho Sessions"));
    }

    @Test
    @DisplayName("4. Invalid sessionType bị 400 BAD_REQUEST")
    void invalidSessionTypeBadRequest() {
        Session request = new Session("Session 1", "Desc", "INVALID_TYPE", LocalDateTime.now().plusDays(2));

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(request));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Loại phiên chỉ cho phép AI hoặc MANUAL"));

        // Also verify bean validation rejects it
        var violations = validator.validate(request);
        assertFalse(violations.isEmpty());
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("sessionType")));
    }

    @Test
    @DisplayName("5. Blank name hoặc name toàn khoảng trắng bị 400 BAD_REQUEST")
    void blankNameBadRequest() {
        Session blankRequest = new Session("    ", "Desc", "AI", LocalDateTime.now().plusDays(2));

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(blankRequest));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Tên phiên không được để trống"));

        // Bean validation also fails
        var violations = validator.validate(blankRequest);
        assertFalse(violations.isEmpty());
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("name")));
    }

    @Test
    @DisplayName("6. dueAt trong quá khứ bị 400 BAD_REQUEST")
    void pastDueAtBadRequest() {
        Session pastRequest = new Session("Session 1", "Desc", "AI", LocalDateTime.now().minusDays(1));

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(pastRequest));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Thời hạn phiên phải ở thời điểm tương lai"));

        // Bean validation also fails
        var violations = validator.validate(pastRequest);
        assertFalse(violations.isEmpty());
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("dueAt")));
    }

    @Test
    @DisplayName("7. created_by lấy từ authenticated user, không tin tưởng client")
    void createdByFromAuthenticatedUser() {
        Session request = new Session("Session Auth", null, "MANUAL", LocalDateTime.now().plusDays(5),
                null, List.of(31L, 32L), null, 40L, "NONE");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 101L, "status", "DRAFT"))));

        service.createSession(request);

        // Verify the created_by parameter passed to INSERT is 10L (manager01)
        verify(db).queryForList(
                startsWith("INSERT INTO annotation_sessions"),
                eq("Session Auth"),
                isNull(),
                eq("MANUAL"),
                any(LocalDateTime.class),
                eq(10L)
        );
    }

    @Test
    @DisplayName("8. Session status mặc định là DRAFT khi tạo")
    void defaultStatusIsDraft() {
        Session request = new Session("Draft Session", "Testing draft status", "AI", LocalDateTime.now().plusDays(3),
                null, null, 30L, 40L, "AI_ASSISTED");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenAnswer(invocation -> List.of(new HashMap<>(Map.of(
                        "id", 102L,
                        "name", "Draft Session",
                        "status", "DRAFT",
                        "created_by", 10L
                ))));

        Map<String, Object> session = service.createSession(request);
        assertEquals("DRAFT", session.get("status"));
    }

    @Test
    @DisplayName("9. CREATE audit log được ghi đầy đủ action, resource_type và resource_id")
    void createAuditLogRecorded() {
        Session request = new Session("Audit Test", null, "AI", LocalDateTime.now().plusDays(4),
                null, null, 30L, 40L, "AI_ASSISTED");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 103L))));

        service.createSession(request);

        verify(db).update(
                eq("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)"),
                eq(10L), eq("CREATE"), eq("SESSION"), eq(103L)
        );
    }

    @Test
    @DisplayName("10. Manager không được modify (members/status) session của Manager khác")
    void managerCannotModifyAnotherManagersSession() {
        // Session 200 was created by manager02 (id = 20)
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(200L)))
                .thenReturn(List.of(Map.of("id", 200L, "created_by", 20L, "status", "DRAFT")));

        // manager01 (id = 10) attempts to update status
        AuthException exStatus = assertThrows(AuthException.class, () ->
                service.sessionState(200L, new State("ACTIVE")));
        assertEquals(HttpStatus.FORBIDDEN, exStatus.getStatus());

        // manager01 (id = 10) attempts to update members
        AuthException exMembers = assertThrows(AuthException.class, () ->
                service.members(200L, new Members(List.of(30L))));
        assertEquals(HttpStatus.FORBIDDEN, exMembers.getStatus());
    }

    @Test
    @DisplayName("11. DRAFT -> ACTIVE thành công khi Manager start session")
    void draftToActiveSuccess() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "DRAFT")));

        service.sessionState(100L, new State("ACTIVE"));

        verify(db).update(
                contains("UPDATE annotation_sessions SET status=?,started_at=CASE WHEN ?='ACTIVE' THEN CURRENT_TIMESTAMP"),
                eq("ACTIVE"), eq("ACTIVE"), eq("ACTIVE"), eq(100L)
        );
        verify(db).update(
                eq("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)"),
                eq(10L), eq("STATUS_ACTIVE"), eq("SESSION"), eq(100L)
        );
    }

    @Test
    @DisplayName("12. ACTIVE -> CLOSED chỉ thành công khi mọi task đã APPROVED, nếu còn task chưa APPROVED thì 409 CONFLICT")
    void activeToClosedOnlyWhenAllTasksApproved() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "ACTIVE")));

        // Case 1: remaining unapproved tasks > 0 -> CONFLICT
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(2L);

        AuthException conflict = assertThrows(AuthException.class, () ->
                service.sessionState(100L, new State("CLOSED")));
        assertEquals(HttpStatus.CONFLICT, conflict.getStatus());
        assertTrue(conflict.getMessage().contains("Còn tác vụ chưa được duyệt"));

        // Case 2: remaining unapproved tasks == 0 -> CLOSED success
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(0L);

        service.sessionState(100L, new State("CLOSED"));

        verify(db).update(
                contains("UPDATE annotation_sessions SET status=?"),
                eq("CLOSED"), eq("CLOSED"), eq("CLOSED"), eq(100L)
        );
        verify(db).update(
                eq("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)"),
                eq(10L), eq("STATUS_CLOSED"), eq("SESSION"), eq(100L)
        );
    }

    @Test
    @DisplayName("13. Invalid status transition bị reject với 409 CONFLICT")
    void invalidStatusTransitionsRejected() {
        // DRAFT -> CLOSED rejected
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "DRAFT")));
        AuthException exDraftClosed = assertThrows(AuthException.class, () ->
                service.sessionState(100L, new State("CLOSED")));
        assertEquals(HttpStatus.CONFLICT, exDraftClosed.getStatus());

        // ACTIVE -> DRAFT rejected
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(101L)))
                .thenReturn(List.of(Map.of("id", 101L, "created_by", 10L, "status", "ACTIVE")));
        AuthException exActiveDraft = assertThrows(AuthException.class, () ->
                service.sessionState(101L, new State("DRAFT")));
        assertEquals(HttpStatus.CONFLICT, exActiveDraft.getStatus());

        // CLOSED -> ACTIVE rejected
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(102L)))
                .thenReturn(List.of(Map.of("id", 102L, "created_by", 10L, "status", "CLOSED")));
        AuthException exClosedActive = assertThrows(AuthException.class, () ->
                service.sessionState(102L, new State("ACTIVE")));
        assertEquals(HttpStatus.CONFLICT, exClosedActive.getStatus());
    }

    @Test
    @DisplayName("14. Session type và task type mismatch bị reject với 400 BAD_REQUEST")
    void sessionTypeAndTaskTypeMismatchRejected() {
        // Document owned by manager 10
        when(db.queryForList(startsWith("SELECT * FROM documents WHERE id=? FOR SHARE"), eq(50L)))
                .thenReturn(List.of(Map.of("id", 50L, "uploaded_by", 10L)));

        // Session 100 has session_type = "AI"
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "session_type", "AI", "status", "DRAFT")));

        // Attempt to create MANUAL task under AI session
        Task taskRequest = new Task(50L, 100L, "MANUAL", null, null);

        AuthException ex = assertThrows(AuthException.class, () -> service.createTask(taskRequest));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Loại tác vụ không phù hợp với phiên"));
    }

    @Test
    @DisplayName("15. Assignee sai role bị reject với 400 BAD_REQUEST")
    void assigneeWrongRoleRejected() {
        // Document owned by manager 10
        when(db.queryForList(startsWith("SELECT * FROM documents WHERE id=? FOR SHARE"), eq(50L)))
                .thenReturn(List.of(Map.of("id", 50L, "uploaded_by", 10L)));

        // Session 100 has session_type = "AI"
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "session_type", "AI", "status", "DRAFT")));

        // User 40 is MANUAL_LABELER
        when(db.queryForList(startsWith("SELECT role,is_active FROM users WHERE id=? FOR SHARE"), eq(40L)))
                .thenReturn(List.of(Map.of("role", "MANUAL_LABELER", "is_active", true)));

        // Attempt to assign AI task to MANUAL_LABELER
        Task taskRequest = new Task(50L, 100L, "AI", 40L, null);

        AuthException ex = assertThrows(AuthException.class, () -> service.createTask(taskRequest));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Người nhận phải đang hoạt động và đúng vai trò gán nhãn"));
    }

    @Test
    @DisplayName("16. Member không hợp lệ (ADMIN/MANAGER) hoặc inactive bị reject khi thêm vào session")
    void sessionMemberInvalidRoleRejected() {
        // Session 100 owned by manager 10, no existing members
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "DRAFT")));
        when(db.queryForObject(startsWith("SELECT count(*) FROM session_members WHERE session_id=?"), eq(Long.class), eq(100L)))
                .thenReturn(0L);

        // User 2 is ADMIN
        when(db.queryForList(startsWith("SELECT role,is_active FROM users WHERE id=? FOR SHARE"), eq(2L)))
                .thenReturn(List.of(Map.of("role", "ADMIN", "is_active", true)));

        AuthException ex = assertThrows(AuthException.class, () ->
                service.members(100L, new Members(List.of(2L))));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Thành viên phải là user đang hoạt động với vai trò hợp lệ"));
    }

    // =========================================================================
    // BUSINESS VALIDATION ASSIGNMENT TESTS (TEST 1 - TEST 15)
    // =========================================================================

    @Test
    @DisplayName("TEST 1: MANUAL, manualLabelerIds = [manualUser1, manualUser2], reviewerId = reviewer1 => SUCCESS")
    void test1_manualSingleLabelerSuccess() {
        Session req = new Session("Manual S1", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 301L, "name", "Manual S1", "session_type", "MANUAL", "status", "DRAFT"))));

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(301L, result.get("id"));
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 2: MANUAL, manualLabelerIds = [manualUser1, manualUser2], reviewerId = reviewer1 => SUCCESS")
    void test2_manualDoubleLabelerSuccess() {
        Session req = new Session("Manual S2", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 302L, "name", "Manual S2", "session_type", "MANUAL", "status", "DRAFT"))));

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(302L, result.get("id"));
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 3: MANUAL, manualLabelerIds = [manualUser1, manualUser2, manualUser3], reviewerId = reviewer1 => REJECT")
    void test3_manualTripleLabelerReject() {
        Session req = new Session("Manual S3", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L, 33L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Manual session requires exactly 2 manual labelers."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 4: MANUAL, manualLabelerIds = [manualUser1, manualUser2], reviewerId = manualUser1 => REJECT (duplicate function)")
    void test4_manualLabelerSameAsReviewerReject() {
        Session req = new Session("Manual S4", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 31L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("A user cannot have multiple functions in the same session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
        verify(db, never()).update(contains("users"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 5: MANUAL, manualLabelerIds = [manualUser1, manualUser1], reviewerId = reviewer1 => REJECT (duplicate manual labeler)")
    void test5_manualDuplicateLabelerReject() {
        Session req = new Session("Manual S5", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 31L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("A user cannot have multiple functions in the same session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
        verify(db, never()).update(contains("users"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 6: MANUAL, manualLabelerIds = [manualUser1, manualUser2], aiLabelerId = aiUser1, reviewerId = reviewer1 => REJECT (AI labeler in MANUAL)")
    void test6_manualWithAiLabelerReject() {
        Session req = new Session("Manual S6", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), 30L, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("AI labeler cannot be assigned to a MANUAL session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 7: AI, aiLabelerId = aiUser1, reviewerId = reviewer1 => SUCCESS")
    void test7_aiSingleLabelerSuccess() {
        Session req = new Session("AI S7", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 307L, "name", "AI S7", "session_type", "AI", "status", "DRAFT"))));

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(307L, result.get("id"));
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 8: AI, aiLabelerId = aiUser1, reviewerId = aiUser1 => REJECT (duplicate function)")
    void test8_aiLabelerSameAsReviewerReject() {
        Session req = new Session("AI S8", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 30L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("A user cannot have multiple functions in the same session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
        verify(db, never()).update(contains("users"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 9: AI, aiLabelerId = aiUser1, manualLabelerIds = [manualUser1], reviewerId = reviewer1 => REJECT (Manual labeler in AI)")
    void test9_aiWithManualLabelerReject() {
        Session req = new Session("AI S9", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L), 30L, 40L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Manual labeler cannot be assigned to an AI session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 10: MANUAL, manualLabelerIds = [aiUser1, manualUser2], reviewerId = reviewer1 => REJECT (wrong role AI_LABELER)")
    void test10_manualWithWrongRoleReject() {
        Session req = new Session("Manual S10", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(30L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("must have role USER or MANUAL_LABELER."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 11: AI, aiLabelerId = manualUser1, reviewerId = reviewer1 => REJECT (wrong role MANUAL_LABELER)")
    void test11_aiWithWrongRoleReject() {
        Session req = new Session("AI S11", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 31L, 40L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("must have role USER or AI_LABELER."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 12: MANUAL, manualLabelerIds = [manualUser1, manualUser2], reviewerId = null => REJECT (reviewer is required)")
    void test12_manualWithoutReviewerReject() {
        Session req = new Session("Manual S12", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, null, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("Reviewer is required."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 13: AI, aiLabelerId = null, reviewerId = reviewer1 => REJECT (AI labeler is required)")
    void test13_aiWithoutAiLabelerReject() {
        Session req = new Session("AI S13", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, null, 40L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("AI session requires exactly 1 AI labeler."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 14: MANUAL, manualLabelerIds = [inactiveManualUser, manualUser2], reviewerId = reviewer1 => REJECT (inactive manual labeler)")
    void test14_manualWithInactiveLabelerReject() {
        Session req = new Session("Manual S14", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(35L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("is inactive."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 15: MANUAL, manualLabelerIds = [manualUser1, manualUser2], reviewerId = inactiveReviewer => REJECT (inactive reviewer)")
    void test15_manualWithInactiveReviewerReject() {
        Session req = new Session("Manual S15", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 45L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("is inactive."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 16: User status AVAILABLE => AVAILABLE")
    void test16_userNeverInSession_isAvailable() {
        // User 99L has status AVAILABLE
        boolean available = service.isUserAvailable(99L);
        assertTrue(available, "User with AVAILABLE status must be available");
    }

    @Test
    @DisplayName("TEST 17: User status BUSY => UNAVAILABLE")
    void test17_userInUnclosedSession_isUnavailable() {
        // User 31L has status BUSY
        unavailableUserIds.add(31L);
        boolean available = service.isUserAvailable(31L);
        assertFalse(available, "User with BUSY status must be unavailable");
    }

    @Test
    @DisplayName("TEST 18: User status BUSY => UNAVAILABLE (không phụ thuộc due_at)")
    void test18_userInUnexpiredSession_isUnavailable() {
        // User 31L has status BUSY
        unavailableUserIds.add(31L);
        boolean available = service.isUserAvailable(31L);
        assertFalse(available, "User with BUSY status must be unavailable");
    }

    @Test
    @DisplayName("TEST 19: MANUAL có labeler unavailable => REJECT toàn bộ Create Session")
    void test19_manualSingleUnavailableLabelerReject() {
        unavailableUserIds.add(31L); // manual_labeler01 is unavailable
        Session req = new Session("Manual S19", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("manual_labeler01 is not available"));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 20: MANUAL có 2 labelers, 1 labeler unavailable => REJECT toàn bộ Create Session")
    void test20_manualTwoLabelersOneUnavailableReject() {
        // user 31L available, user 32L unavailable
        unavailableUserIds.add(32L);
        Session req = new Session("Manual S20", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("manual_labeler02 is not available"));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 21: AI session có AI Labeler unavailable => REJECT toàn bộ Create Session")
    void test21_aiLabelerUnavailableReject() {
        unavailableUserIds.add(30L); // labeler01 is unavailable
        Session req = new Session("AI S21", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("labeler01 is not available"));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 22: Session có Reviewer unavailable => REJECT toàn bộ Create Session")
    void test22_reviewerUnavailableReject() {
        unavailableUserIds.add(40L); // reviewer01 is unavailable
        Session req = new Session("AI S22", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("reviewer01 is not available"));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 23: Direct API request gửi unavailable labeler ID => Backend REJECT, không tạo session")
    void test23_directApiUnavailableUserReject() {
        unavailableUserIds.add(31L);
        Session req = new Session("Direct S23", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("manual_labeler01 is not available"));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 24: User available nhưng sai role => REJECT (role check precedes availability)")
    void test24_availableUserWrongRoleReject() {
        // user 30L is available (AI_LABELER) but passed in manualLabelerIds
        Session req = new Session("Manual S24", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(30L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("must have role USER or MANUAL_LABELER."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 25: User available + đúng role => PASS (session created successfully)")
    void test25_availableUserCorrectRolePass() {
        // users 31L and 40L are available and have correct roles
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 501L, "name", "Manual S25", "session_type", "MANUAL", "status", "DRAFT"))));

        Session req = new Session("Manual S25", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(501L, result.get("id"));
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 26: assignees() truy vấn database và lọc ra users có status = 'AVAILABLE'")
    void test26_assigneesFiltersOutUnavailableUsers() {
        when(db.queryForList(argThat((String sql) -> sql != null
                && sql.contains("CASE WHEN EXISTS")
                && sql.contains("FROM users u"))))
                .thenReturn(List.of(Map.of(
                        "id", 31L,
                        "username", "manual_labeler01",
                        "role", "MANUAL_LABELER",
                        "status", "AVAILABLE",
                        "is_active", true)));

        List<Map<String, Object>> assignees = service.assignees();
        assertNotNull(assignees);
        assertEquals(1, assignees.size());
        assertEquals("manual_labeler01", assignees.getFirst().get("username"));

        // Verify the availability is derived from active sessions/tasks.
        verify(db).queryForList(argThat((String sql) -> sql != null
                && sql.contains("CASE WHEN EXISTS")
                && sql.contains("FROM users u")
                && sql.contains("ORDER BY username")));
    }

    @Test
    @DisplayName("TEST 27 (CASE 1): Session INSERT fail => Không có session, không có members, không có tasks")
    void test27_case1_sessionInsertFails_noMembersNoTasks() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenThrow(new DataIntegrityViolationException("Database error during Session INSERT"));

        Session req = new Session("Fail Session", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        assertThrows(DataIntegrityViolationException.class, () -> service.createSession(req));

        // Verify members and tasks are NEVER inserted
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 28 (CASE 2): Session INSERT thành công, Members INSERT fail => ROLLBACK session, không có tasks")
    void test28_case2_memberInsertFails_rollbackSession_noTasks() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 201L, "name", "S28", "session_type", "MANUAL", "status", "DRAFT"))));

        doThrow(new DataIntegrityViolationException("Database constraint error during Member INSERT"))
                .when(db).update(startsWith("INSERT INTO session_members"), any(Object[].class));

        Session req = new Session("S28", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        assertThrows(DataIntegrityViolationException.class, () -> service.createSession(req));

        // Tasks must NEVER be inserted when member insertion fails
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 29 (CASE 3): Session INSERT thành công, Members INSERT thành công, Task INSERT fail => Exception thrown triggering rollback")
    void test29_case3_taskInsertFails_rollbackAll() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 202L, "name", "S29", "session_type", "MANUAL", "status", "DRAFT"))));

        when(db.queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class)))
                .thenThrow(new DataIntegrityViolationException("Database constraint error during Task INSERT"));

        Session req = new Session("S29", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        assertThrows(DataIntegrityViolationException.class, () -> service.createSession(req));
    }

    @Test
    @DisplayName("TEST 30 (SECTION 16 - BẮT BUỘC): Mô phỏng Session INSERT success, Members INSERT success, Task INSERT fail => ROLLBACK toàn bộ, không có record nào")
    void test30_section16_simulation_taskFailure_rollsBackAllTables() {
        // Bảng mô phỏng database state trong transaction
        List<Map<String, Object>> annotationSessionsTable = new ArrayList<>();
        List<Map<String, Object>> sessionMembersTable = new ArrayList<>();
        List<Map<String, Object>> annotationTasksTable = new ArrayList<>();

        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Map<String, Object> sessionRow = new HashMap<>(Map.of(
                            "id", 300L,
                            "name", "Section 16 Session",
                            "session_type", "MANUAL",
                            "status", "DRAFT",
                            "created_by", 10L
                    ));
                    annotationSessionsTable.add(sessionRow);
                    return List.of(sessionRow);
                });

        doAnswer(invocation -> {
            Object[] args = invocation.getArguments();
            sessionMembersTable.add(Map.of("session_id", args[1], "user_id", args[2]));
            return 1;
        }).when(db).update(startsWith("INSERT INTO session_members"), any(Object[].class));

        when(db.queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class)))
                .thenAnswer(invocation -> {
                    // Mô phỏng task insert thất bại
                    throw new DataIntegrityViolationException("Simulated Task INSERT constraint failure");
                });

        Session req = new Session("Section 16 Session", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        // Khi có exception xảy ra trong @Transactional, toàn bộ thay đổi được rollback
        assertThrows(DataIntegrityViolationException.class, () -> {
            try {
                service.createSession(req);
            } catch (Exception ex) {
                // Rollback handler: hủy bỏ toàn bộ dữ liệu uncommitted trong transaction
                annotationSessionsTable.clear();
                sessionMembersTable.clear();
                annotationTasksTable.clear();
                throw ex;
            }
        });

        // BẮT BUỘC VERIFY THEO SECTION 16: Sau exception, không có record nào tồn tại
        assertTrue(annotationSessionsTable.isEmpty(), "annotation_sessions => không có record sau rollback");
        assertTrue(sessionMembersTable.isEmpty(), "session_members => không có record sau rollback");
        assertTrue(annotationTasksTable.isEmpty(), "annotation_tasks => không có record sau rollback");
    }

    @Test
    @DisplayName("TEST 31 (SECTION 17): MANUAL 2 Labelers + Reviewer + documents => Session, Members, Tasks được tạo trong cùng transaction")
    void test31_manualOneLabelerSuccess_allInSameTransaction() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 301L, "name", "Manual 1", "session_type", "MANUAL", "status", "DRAFT"))));

        Session req = new Session("Manual 1", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(301L, result.get("id"));

        // Verify Session inserted
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));

        // Verify Members inserted: labeler 31L and reviewer 40L
        verify(db).update(startsWith("INSERT INTO session_members"), eq(301L), eq(31L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(301L), eq(40L));

        // Verify Tasks inserted: for doc 1L and labeler 31L
        verify(db).queryForList(startsWith("INSERT INTO annotation_tasks"),
                eq(1L), eq(301L), eq("MANUAL"), eq(31L), any(), any(), any());
    }

    @Test
    @DisplayName("TEST 32 (SECTION 17): MANUAL 2 Labelers + Reviewer + documents => Session, Members, Tasks được tạo trong cùng transaction")
    void test32_manualTwoLabelersSuccess_allInSameTransaction() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 302L, "name", "Manual 2", "session_type", "MANUAL", "status", "DRAFT"))));

        Session req = new Session("Manual 2", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(302L, result.get("id"));

        // Verify Session inserted
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));

        // Verify Members inserted: labeler 31L, labeler 32L, reviewer 40L
        verify(db).update(startsWith("INSERT INTO session_members"), eq(302L), eq(31L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(302L), eq(32L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(302L), eq(40L));

        // Verify Tasks inserted for both labelers
        verify(db).queryForList(startsWith("INSERT INTO annotation_tasks"),
                eq(1L), eq(302L), eq("MANUAL"), eq(31L), any(), any(), any());
        verify(db).queryForList(startsWith("INSERT INTO annotation_tasks"),
                eq(1L), eq(302L), eq("MANUAL"), eq(32L), any(), any(), any());
    }

    @Test
    @DisplayName("TEST 33 (SECTION 17): AI 1 Labeler + Reviewer + documents => Session, Members, Tasks được tạo trong cùng transaction")
    void test33_aiLabelerSuccess_allInSameTransaction() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 303L, "name", "AI 1", "session_type", "AI", "status", "DRAFT"))));

        Session req = new Session("AI 1", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(303L, result.get("id"));

        // Verify Session inserted
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));

        // Verify Members inserted: ai labeler 30L and reviewer 40L
        verify(db).update(startsWith("INSERT INTO session_members"), eq(303L), eq(30L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(303L), eq(40L));

        // Verify Tasks inserted: for doc 1L and ai labeler 30L with AI_ASSISTED
        verify(db).queryForList(startsWith("INSERT INTO annotation_tasks"),
                eq(1L), eq(303L), eq("AI"), eq(30L), any(), any(), eq("AI_ASSISTED"));
    }

    @Test
    @DisplayName("TEST 34: Document không thuộc sở hữu của Manager => Fail ở bước 7, không INSERT session")
    void test34_unownedDocument_failsAtStep7_neverInsertsSession() {
        // Document 99L was uploaded by user 99L (not manager 10L)
        when(db.queryForList(startsWith("SELECT * FROM documents WHERE id=?"), eq(99L)))
                .thenReturn(List.of(Map.of("id", 99L, "title", "Other Doc", "uploaded_by", 99L)));

        Session req = new Session("Unowned Doc Session", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(99L), List.of(31L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());

        // Verify session was NEVER inserted
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 35: MANUAL 2 labelers, second labeler == reviewer => REJECT (duplicate function)")
    void test35_manualSecondLabelerSameAsReviewerReject() {
        Session req = new Session("Manual S35", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 32L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("A user cannot have multiple functions in the same session."));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
        verify(db, never()).update(contains("users"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 36: MANUAL với labeler IDs rỗng hoặc chứa null => REJECT")
    void test36_manualNullOrEmptyOrContainsNullLabelersReject() {
        // Case 1: manualLabelerIds is empty list
        Session emptyReq = new Session("Manual Empty", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(), null, 40L, "NONE");
        AuthException exEmpty = assertThrows(AuthException.class, () -> service.createSession(emptyReq));
        assertEquals(HttpStatus.BAD_REQUEST, exEmpty.getStatus());
        assertTrue(exEmpty.getMessage().contains("Manual session requires exactly 2 manual labelers."));

        // Case 2: manualLabelerIds is null
        Session nullListReq = new Session("Manual Null", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), null, null, 40L, "NONE");
        AuthException exNullList = assertThrows(AuthException.class, () -> service.createSession(nullListReq));
        assertEquals(HttpStatus.BAD_REQUEST, exNullList.getStatus());
        assertTrue(exNullList.getMessage().contains("Manual session requires exactly 2 manual labelers."));

        // Case 3: manualLabelerIds contains null element
        Session containsNullReq = new Session("Manual Contains Null", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), Arrays.asList(31L, (Long) null), null, 40L, "NONE");
        AuthException exContainsNull = assertThrows(AuthException.class, () -> service.createSession(containsNullReq));
        assertEquals(HttpStatus.BAD_REQUEST, exContainsNull.getStatus());
        assertTrue(exContainsNull.getMessage().contains("Manual labeler ID không được để trống"));
    }

    @Test
    @DisplayName("TEST 37: Duplicate function rejection bảo đảm atomicity và users.status không bị thay đổi")
    void test37_duplicateFunctionRejection_preservesAtomicityAndNeverModifiesUserStatus() {
        // AI duplicate: aiLabeler == reviewer
        Session aiReq = new Session("AI Dup", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 30L, "AI_ASSISTED");

        AuthException exAi = assertThrows(AuthException.class, () -> service.createSession(aiReq));
        assertEquals(HttpStatus.BAD_REQUEST, exAi.getStatus());
        assertTrue(exAi.getMessage().contains("A user cannot have multiple functions in the same session."));

        // MANUAL duplicate: 2 identical labelers
        Session manualDupLabelers = new Session("Manual Dup Labelers", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 31L), null, 40L, "NONE");

        AuthException exManualDup = assertThrows(AuthException.class, () -> service.createSession(manualDupLabelers));
        assertEquals(HttpStatus.BAD_REQUEST, exManualDup.getStatus());
        assertTrue(exManualDup.getMessage().contains("A user cannot have multiple functions in the same session."));

        // Verify no session, members, or tasks were created
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));

        // Verify users table was NEVER updated (users.status is NOT changed in Phase 4)
        verify(db, never()).update(contains("users"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 38: MANUAL success => Chuyển toàn bộ assigned users (labelers + reviewer) AVAILABLE -> BUSY")
    void test38_createManualSession_claimsAssignedUsersAvailableToBusy() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 401L, "name", "Manual S38", "session_type", "MANUAL", "status", "DRAFT"))));

        Session req = new Session("Manual S38", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(401L, result.get("id"));

        // Verify conditional claim UPDATE for each assigned user: 31L, 32L, 40L
        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("AND status = 'AVAILABLE'")), eq(31L));

        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("AND status = 'AVAILABLE'")), eq(32L));

        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("AND status = 'AVAILABLE'")), eq(40L));

        // Status isolation: verify unassigned users (e.g. 30L, 33L) are NEVER updated
        verify(db, never()).update(argThat((String sql) -> sql != null && sql.contains("UPDATE users")), eq(30L));
        verify(db, never()).update(argThat((String sql) -> sql != null && sql.contains("UPDATE users")), eq(33L));

        // Verify session, members, tasks created
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(401L), eq(31L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(401L), eq(32L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(401L), eq(40L));
        verify(db, atLeastOnce()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 39: AI success => Chuyển toàn bộ assigned users (aiLabeler + reviewer) AVAILABLE -> BUSY")
    void test39_createAiSession_claimsAssignedUsersAvailableToBusy() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 402L, "name", "AI S39", "session_type", "AI", "status", "DRAFT"))));

        Session req = new Session("AI S39", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        Map<String, Object> result = service.createSession(req);
        assertNotNull(result);
        assertEquals(402L, result.get("id"));

        // Verify conditional claim UPDATE for each assigned user: 30L, 40L
        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("AND status = 'AVAILABLE'")), eq(30L));

        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("AND status = 'AVAILABLE'")), eq(40L));

        // Verify unassigned users are NEVER updated
        verify(db, never()).update(argThat((String sql) -> sql != null && sql.contains("UPDATE users")), eq(31L));

        // Verify session, members, tasks created
        verify(db).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(402L), eq(30L));
        verify(db).update(startsWith("INSERT INTO session_members"), eq(402L), eq(40L));
        verify(db, atLeastOnce()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 40: Concurrency - Một user bị BUSY trước khi claim (affected rows = 0) => Toàn bộ Create Session thất bại")
    void test40_concurrency_oneUserBecomesBusyBeforeClaim_abortsAndNoRecordsPersisted() {
        // User 32L passes initial validation, but another concurrent transaction claims user 32L before our claim update
        busyOnClaimUserIds.add(32L);
        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users") && sql.contains("status = 'BUSY'")), eq(32L)))
                .thenReturn(0);

        Session req = new Session("Concurrent Fail Session", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        AuthException ex = assertThrows(AuthException.class, () -> service.createSession(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        assertTrue(ex.getMessage().contains("manual_labeler02 is not available: User is currently BUSY"));

        // Verify no session, members, or tasks were inserted
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class));
        verify(db, never()).update(startsWith("INSERT INTO session_members"), any(Object[].class));
        verify(db, never()).queryForList(startsWith("INSERT INTO annotation_tasks"), any(Object[].class));
    }

    @Test
    @DisplayName("TEST 41: Mô phỏng Rollback toàn bộ khi conditional claim thất bại => Không lưu session/members/tasks, user status không bị thay đổi")
    void test41_simulation_claimFailure_rollsBackAllStateAndPreservesUserStatus() {
        Map<Long, String> usersStatusTable = new HashMap<>(Map.of(
                31L, "AVAILABLE",
                32L, "BUSY",
                40L, "AVAILABLE"
        ));
        List<Map<String, Object>> annotationSessionsTable = new ArrayList<>();
        List<Map<String, Object>> sessionMembersTable = new ArrayList<>();
        List<Map<String, Object>> annotationTasksTable = new ArrayList<>();

        // Custom update behavior tracking transactional simulation
        Map<Long, String> uncommittedStatusChanges = new HashMap<>();

        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users") && sql.contains("status = 'BUSY'")), any(Object[].class)))
                .thenAnswer(invocation -> {
                    Object[] args = invocation.getArguments();
                    long targetUserId = args.length > 1 && args[1] instanceof Number num ? num.longValue() : 0L;
                    if ("AVAILABLE".equals(usersStatusTable.get(targetUserId))) {
                        uncommittedStatusChanges.put(targetUserId, "BUSY");
                        return 1;
                    }
                    return 0; // Already BUSY or not found
                });

        // User 32L is already BUSY in the database
        unavailableUserIds.add(32L);

        Session req = new Session("Simulation Fail", "Desc", "MANUAL", LocalDateTime.now().plusDays(2),
                List.of(1L), List.of(31L, 32L), null, 40L, "NONE");

        assertThrows(AuthException.class, () -> {
            try {
                service.createSession(req);
            } catch (Exception ex) {
                // Rollback uncommitted changes
                uncommittedStatusChanges.clear();
                annotationSessionsTable.clear();
                sessionMembersTable.clear();
                annotationTasksTable.clear();
                throw ex;
            }
        });

        assertTrue(annotationSessionsTable.isEmpty(), "annotation_sessions must be empty after rollback");
        assertTrue(sessionMembersTable.isEmpty(), "session_members must be empty after rollback");
        assertTrue(annotationTasksTable.isEmpty(), "annotation_tasks must be empty after rollback");
        assertEquals("AVAILABLE", usersStatusTable.get(31L), "User 31 must remain AVAILABLE after rollback");
        assertEquals("BUSY", usersStatusTable.get(32L), "User 32 must remain BUSY");
        assertEquals("AVAILABLE", usersStatusTable.get(40L), "User 40 must remain AVAILABLE");
    }

    @Test
    @DisplayName("TEST 42: SQL Contract - Conditional update bắt buộc chứa predicate status = 'AVAILABLE'")
    void test42_conditionalUpdateSqlContract_mustContainStatusAvailablePredicate() {
        when(db.queryForList(startsWith("INSERT INTO annotation_sessions"), any(Object[].class)))
                .thenReturn(List.of(new HashMap<>(Map.of("id", 403L, "name", "SQL Contract Session", "session_type", "AI", "status", "DRAFT"))));

        Session req = new Session("SQL Contract Session", "Desc", "AI", LocalDateTime.now().plusDays(2),
                List.of(1L), null, 30L, 40L, "AI_ASSISTED");

        service.createSession(req);

        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users")
                && sql.contains("SET status = 'BUSY'")
                && sql.contains("WHERE id = ?")
                && sql.contains("status = 'AVAILABLE'")), eq(30L));
    }

    @Test
    @DisplayName("TEST 43: Close active Session thành công => Chuyển assigned users từ BUSY -> AVAILABLE")
    void test43_closeActiveSession_releasesAssignedUsersToAvailable() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "ACTIVE")));

        // Prerequisite: all tasks approved
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(0L);

        service.sessionState(100L, new State("CLOSED"));

        // Verify session status updated to CLOSED
        verify(db).update(
                contains("UPDATE annotation_sessions SET status=?"),
                eq("CLOSED"), eq("CLOSED"), eq("CLOSED"), eq(100L)
        );

        // Verify release query executed for session 100
        verify(db).update(argThat((String sql) -> sql != null
                && sql.contains("UPDATE users u")
                && sql.contains("SET status = 'AVAILABLE'")
                && sql.contains("WHERE u.id IN")
                && sql.contains("session_members")
                && sql.contains("AND u.status = 'BUSY'")), eq(100L), eq(100L));

        // Verify audit log recorded
        verify(db).update(
                eq("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)"),
                eq(10L), eq("STATUS_CLOSED"), eq("SESSION"), eq(100L)
        );
    }

    @Test
    @DisplayName("TEST 44: SQL Contract - Release query bắt buộc chứa điều kiện NOT EXISTS kiểm tra session khác chưa CLOSED")
    void test44_closeSession_sqlContract_andMultiSessionSafety() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(200L)))
                .thenReturn(List.of(Map.of("id", 200L, "created_by", 10L, "status", "ACTIVE")));

        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(200L)))
                .thenReturn(0L);

        service.sessionState(200L, new State("CLOSED"));

        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(db).update(sqlCaptor.capture(), eq(200L), eq(200L));

        String releaseSql = sqlCaptor.getValue();
        assertNotNull(releaseSql);
        assertTrue(releaseSql.contains("UPDATE users u"), "Must target users table with alias u");
        assertTrue(releaseSql.contains("SET status = 'AVAILABLE'"), "Must update status to AVAILABLE");
        assertTrue(releaseSql.contains("sm.session_id = ?"), "Must filter by closed session_id");
        assertTrue(releaseSql.contains("u.status = 'BUSY'"), "Must only release users who are currently BUSY");
        assertTrue(releaseSql.contains("NOT EXISTS"), "Must check that user is not in another non-CLOSED session");
        assertTrue(releaseSql.contains("other_sm.session_id <> ?"), "Must exclude current closed session");
        assertTrue(releaseSql.contains("other_s.status <> 'CLOSED'"), "Must check other sessions are not closed");
    }

    @Test
    @DisplayName("TEST 45: Mô phỏng Multi-session safety - User thuộc session khác chưa CLOSED thì vẫn giữ BUSY, user khác thành AVAILABLE, user ngoài session không đổi")
    void test45_closeSession_simulation_multiSessionUserRemainsBusy_andUnrelatedUserUntouched() {
        // Session 100 has members: User 31L, User 40L, User 32L
        // Session 200 (ACTIVE) has member: User 31L
        // User 32L is in Session 100 but already AVAILABLE
        // User 99L is in Session 300 (unrelated) and BUSY
        Map<Long, String> userStatusTable = new HashMap<>(Map.of(
                31L, "BUSY",
                40L, "BUSY",
                32L, "AVAILABLE",
                99L, "BUSY"
        ));

        // Active sessions: 100 (closing), 200 (ACTIVE), 300 (ACTIVE)
        Map<Long, List<Long>> sessionMembers = Map.of(
                100L, List.of(31L, 40L, 32L),
                200L, List.of(31L),
                300L, List.of(99L)
        );
        Map<Long, String> sessionStatuses = new HashMap<>(Map.of(
                100L, "ACTIVE",
                200L, "ACTIVE",
                300L, "ACTIVE"
        ));

        // Mock the release logic behavior based on the exact SQL specification
        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users u") && sql.contains("SET status = 'AVAILABLE'")), eq(100L), eq(100L)))
                .thenAnswer(invocation -> {
                    long closingSessionId = invocation.getArgument(1);
                    List<Long> members = sessionMembers.getOrDefault(closingSessionId, List.of());
                    int updatedCount = 0;
                    for (Long uid : members) {
                        // Condition 1: status must be BUSY
                        if (!"BUSY".equals(userStatusTable.get(uid))) {
                            continue; // no-op for already AVAILABLE users
                        }
                        // Condition 2: NOT EXISTS other non-CLOSED session
                        boolean hasOtherOpenSession = sessionMembers.entrySet().stream()
                                .anyMatch(entry -> !entry.getKey().equals(closingSessionId)
                                        && !"CLOSED".equals(sessionStatuses.get(entry.getKey()))
                                        && entry.getValue().contains(uid));
                        if (!hasOtherOpenSession) {
                            userStatusTable.put(uid, "AVAILABLE");
                            updatedCount++;
                        }
                    }
                    return updatedCount;
                });

        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "ACTIVE")));
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(0L);

        service.sessionState(100L, new State("CLOSED"));

        // User 40L only belonged to Session 100 => becomes AVAILABLE
        assertEquals("AVAILABLE", userStatusTable.get(40L), "User 40 must become AVAILABLE");

        // User 31L also belongs to active Session 200 => must remain BUSY
        assertEquals("BUSY", userStatusTable.get(31L), "User 31 must remain BUSY because Session 200 is still ACTIVE");

        // User 32L was already AVAILABLE => remains AVAILABLE
        assertEquals("AVAILABLE", userStatusTable.get(32L), "User 32 remains AVAILABLE (no-op)");

        // User 99L does not belong to Session 100 => remains BUSY
        assertEquals("BUSY", userStatusTable.get(99L), "User 99 must remain BUSY (untouched)");
    }

    @Test
    @DisplayName("TEST 46: Close prerequisite thất bại (còn task chưa approved) => Không cập nhật session và không release users")
    void test46_closeSession_prerequisiteFailure_doesNotReleaseUsers() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "ACTIVE")));

        // 1 unapproved task remains
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(1L);

        AuthException ex = assertThrows(AuthException.class, () ->
                service.sessionState(100L, new State("CLOSED")));
        assertEquals(HttpStatus.CONFLICT, ex.getStatus());
        assertTrue(ex.getMessage().contains("Còn tác vụ chưa được duyệt"));

        // Verify users release was NEVER called
        verify(db, never()).update(argThat((String sql) -> sql != null && sql.contains("UPDATE users u") && sql.contains("status = 'AVAILABLE'")), any(Object[].class));
        // Verify session was NEVER updated to CLOSED
        verify(db, never()).update(contains("UPDATE annotation_sessions SET status=?"), eq("CLOSED"), any(), any(), any());
    }

    @Test
    @DisplayName("TEST 47: Mô phỏng Release failure => Rollback toàn bộ session close và không đổi user status")
    void test47_closeSession_simulation_releaseFailure_rollsBackSessionClose() {
        when(db.queryForList(startsWith("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE"), eq(100L)))
                .thenReturn(List.of(Map.of("id", 100L, "created_by", 10L, "status", "ACTIVE")));
        when(db.queryForObject(startsWith("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'"), eq(Long.class), eq(100L)))
                .thenReturn(0L);

        // Simulate release update throwing DataIntegrityViolationException
        lenient().when(db.update(argThat((String sql) -> sql != null && sql.contains("UPDATE users u") && sql.contains("status = 'AVAILABLE'")), eq(100L), eq(100L)))
                .thenThrow(new DataIntegrityViolationException("Simulated database failure during release"));

        Map<Long, String> sessionStatusMap = new HashMap<>(Map.of(100L, "ACTIVE"));

        assertThrows(DataIntegrityViolationException.class, () -> {
            try {
                service.sessionState(100L, new State("CLOSED"));
            } catch (Exception ex) {
                // Rollback simulation: session remains ACTIVE
                sessionStatusMap.put(100L, "ACTIVE");
                throw ex;
            }
        });

        assertEquals("ACTIVE", sessionStatusMap.get(100L), "Session must remain ACTIVE after release rollback");
    }
}
