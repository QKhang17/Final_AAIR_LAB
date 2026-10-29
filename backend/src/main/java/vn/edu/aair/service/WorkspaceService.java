package vn.edu.aair.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.edu.aair.dto.WorkspaceRequests.*;
import vn.edu.aair.exception.AuthException;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/** Business rules and row-level access for the existing PostgreSQL schema. */
@Service
@Transactional
public class WorkspaceService {
    public static final Set<String> ROLES = Set.of("USER", "ADMIN", "MANAGER", "AI_LABELER", "MANUAL_LABELER", "REVIEWER", "RESULT_ANALYST", "TERMINOLOGY");
    public static final Set<String> ACCOUNT_MANAGEMENT_ROLES = Set.of("ADMIN", "MANAGER");
    public static final List<String> PERMISSION_FEATURES = List.of(
            "DASHBOARD", "USER_MANAGEMENT", "PERMISSION_MANAGEMENT", "AUDIT_LOGS",
            "DOCUMENTS", "SESSIONS", "TASKS", "STATISTICS");
    public static final List<String> PERMISSION_ACTIONS = List.of("READ", "WRITE", "EXECUTE", "DELETE");
    private static final Map<String, String> PERMISSION_LABELS = Map.of(
            "DASHBOARD", "Dashboard",
            "USER_MANAGEMENT", "User Management",
            "PERMISSION_MANAGEMENT", "Permission Management",
            "AUDIT_LOGS", "Audit Logs",
            "DOCUMENTS", "Documents",
            "SESSIONS", "Sessions",
            "TASKS", "Tasks",
            "STATISTICS", "Statistics");
    private static final Map<String, Set<String>> ROLE_PERMISSION_FEATURES = Map.of(
            "ADMIN", Set.of("DASHBOARD", "USER_MANAGEMENT", "PERMISSION_MANAGEMENT", "AUDIT_LOGS"),
            "MANAGER", Set.of("DASHBOARD", "USER_MANAGEMENT", "PERMISSION_MANAGEMENT", "DOCUMENTS", "SESSIONS", "TASKS", "STATISTICS"));
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%";
    private static final String USER_COLUMNS = "id, username, email, role, is_active, created_at, created_by";
    private static final List<String> REQUIRED_FINANCIAL_FIELDS = List.of(
            "COMPANY_NAME", "INDUSTRY", "REPORT_PERIOD", "REPORT_YEAR", "REVENUE");
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final AccountMailService accountMail;

    public WorkspaceService(JdbcTemplate db, PasswordEncoder passwords, AccountMailService accountMail) {
        this.db = db;
        this.passwords = passwords;
        this.accountMail = accountMail;
    }

    public record Actor(long id, String username, String role) {}
    public Actor actor() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) throw error(HttpStatus.UNAUTHORIZED, "Bạn cần đăng nhập");
        var rows = db.queryForList("SELECT id, username, role FROM users WHERE lower(username)=lower(?) AND is_active=true", auth.getName());
        if (rows.isEmpty()) throw error(HttpStatus.UNAUTHORIZED, "Phiên đăng nhập không còn hợp lệ");
        var u = rows.getFirst();
        String role = String.valueOf(u.get("role")).trim().toUpperCase(Locale.ROOT);
        return new Actor(id(u, "id"), (String)u.get("username"), role);
    }
    public void require(Actor a, String... roles) {
        if (!Arrays.asList(roles).contains(a.role())) throw error(HttpStatus.FORBIDDEN, "Vai trò không có quyền thực hiện thao tác này");
    }
    public static AuthException error(HttpStatus status, String message) {
        return new AuthException(status.name(), status, message);
    }
    private void valid(boolean condition, String message) {
        if (!condition) throw error(HttpStatus.BAD_REQUEST, message);
    }
    private void state(boolean condition, String message) {
        if (!condition) throw error(HttpStatus.CONFLICT, message);
    }
    private void owns(Actor a, Map<String,Object> row, String column) {
        if (!Objects.equals(a.id(), nullableId(row, column))) throw error(HttpStatus.FORBIDDEN, "Bạn không được phân công hoặc không quản lý dữ liệu này");
    }
    public static long id(Map<String,Object> row, String key) { return ((Number)row.get(key)).longValue(); }
    private static Long nullableId(Map<String,Object> row, String key) {
        return row.get(key) == null ? null : id(row, key);
    }
    private static String normalizeRole(String role) {
        return role == null ? "" : role.trim().toUpperCase(Locale.ROOT);
    }
    private static String normalizePermissionValue(String value, Set<String> allowed, String message) {
        String normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (!allowed.contains(normalized)) throw error(HttpStatus.BAD_REQUEST, message);
        return normalized;
    }
    private boolean usesDynamicPermissions(Actor a) {
        return ACCOUNT_MANAGEMENT_ROLES.contains(a.role());
    }
    private boolean hasPermission(Actor a, String feature, String action) {
        if (!usesDynamicPermissions(a)) return true;
        Boolean override = db.query("SELECT enabled FROM user_permission_overrides WHERE user_id=? AND feature=? AND action=?", rs -> rs.next() ? rs.getBoolean("enabled") : null, a.id(), feature, action);
        if (override != null) return override;
        return count("SELECT COUNT(*) FROM role_permissions WHERE role=? AND feature=? AND action=? AND enabled=true",
                a.role(), feature, action) > 0;
    }
    private void requirePermission(Actor a, String feature, String action) {
        if (!hasPermission(a, feature, action))
            throw error(HttpStatus.FORBIDDEN, "Vai trò " + a.role() + " không có quyền " + action + " cho " + PERMISSION_LABELS.getOrDefault(feature, feature));
    }
    private Map<String,Object> one(String sql, Object... args) {
        var rows = db.queryForList(sql, args);
        if (rows.isEmpty()) throw error(HttpStatus.NOT_FOUND, "Không tìm thấy dữ liệu");
        return rows.getFirst();
    }
    private long count(String sql, Object... args) {
        Long val = db.queryForObject(sql, Long.class, args);
        return val == null ? 0L : val;
    }
    public void audit(Actor a, String action, String resource, Long resourceId) {
        db.update("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id) VALUES (?,?,?,?)", a.id(), action, resource, resourceId);
    }
    public void audit(Actor a, String action, String resource, Long resourceId, String detail) {
        db.update("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,detail) VALUES (?,?,?,?,?)", a.id(), action, resource, resourceId, detail);
    }

    public List<Map<String,Object>> users() {
        var a = actor(); require(a, "ADMIN", "MANAGER"); requirePermission(a, "USER_MANAGEMENT", "READ");
        return db.queryForList("SELECT " + USER_COLUMNS + " FROM users ORDER BY id");
    }
    public List<String> accountManagementRoles() {
        var a = actor(); require(a, "ADMIN", "MANAGER"); requirePermission(a, "USER_MANAGEMENT", "READ");
        return ACCOUNT_MANAGEMENT_ROLES.stream().sorted().toList();
    }
    public List<Map<String,Object>> assignees() {
        var a = actor(); require(a, "MANAGER"); requirePermission(a, "TASKS", "READ");
        return db.queryForList("""
                SELECT id, username, role,
                       CASE WHEN EXISTS (
                           SELECT 1 FROM session_members sm
                           JOIN annotation_sessions s ON s.id=sm.session_id
                           WHERE sm.user_id=u.id AND s.status IN ('DRAFT','ACTIVE')
                       ) OR EXISTS (
                           SELECT 1 FROM annotation_tasks at
                           JOIN annotation_sessions s ON s.id=at.session_id
                           WHERE at.assigned_to=u.id AND s.status IN ('DRAFT','ACTIVE')
                       ) THEN 'BUSY' ELSE status END AS status,
                       is_active FROM users u
                WHERE is_active = true
                  AND role IN ('USER','AI_LABELER','MANUAL_LABELER','REVIEWER','RESULT_ANALYST')
                ORDER BY username
                """);
    }
    public Map<String,Object> createUser(CreateUser r) {
        var a = actor(); require(a, "ADMIN", "MANAGER"); requirePermission(a, "USER_MANAGEMENT", "WRITE");
        String requestedRole = r.role() == null ? "" : r.role().trim().toUpperCase(Locale.ROOT);
        valid(ACCOUNT_MANAGEMENT_ROLES.contains(requestedRole), "Vai trò không hợp lệ");
        String username = r.username().trim();
        String email = r.email().trim().toLowerCase(Locale.ROOT);
        state(count("SELECT COUNT(*) FROM users WHERE lower(email)=lower(?)", email) == 0,
                "Email đã tồn tại vui lòng nhập email khác");
        String initialPassword = generateInitialPassword();
        var row = one("INSERT INTO users(username,email,password,role,created_by) VALUES (?,?,?,?,?) RETURNING " + USER_COLUMNS,
                username, email, passwords.encode(initialPassword), requestedRole, a.username());
        accountMail.sendCredentials(email, username, initialPassword, requestedRole);
        audit(a, "CREATE", "USER", id(row,"id")); return row;
    }
    static String generateInitialPassword() {
        var value = new StringBuilder("Aa2@");
        while (value.length() < 16) value.append(PASSWORD_CHARS.charAt(RANDOM.nextInt(PASSWORD_CHARS.length())));
        char[] chars = value.toString().toCharArray();
        for (int i = chars.length - 1; i > 0; i--) {
            int j = RANDOM.nextInt(i + 1);
            char current = chars[i]; chars[i] = chars[j]; chars[j] = current;
        }
        return new String(chars);
    }
    public Map<String,Object> updateUser(long userId, UpdateUser r) {
        var a = actor(); require(a, "ADMIN", "MANAGER"); requirePermission(a, "USER_MANAGEMENT", "WRITE");
        valid(ACCOUNT_MANAGEMENT_ROLES.contains(r.role()), "Vai trò không hợp lệ");
        one("SELECT id FROM users WHERE id=? FOR UPDATE", userId);
        state(a.id()!=userId || (r.active() && r.role().equals("ADMIN")), "Không thể tự khóa hoặc hạ quyền tài khoản Admin đang sử dụng");
        var row = one("UPDATE users SET role=?, is_active=? WHERE id=? RETURNING " + USER_COLUMNS, r.role(), r.active(), userId);
        audit(a,"UPDATE_ROLE_STATUS","USER",userId); return row;
    }
    public Map<String,Object> profile() {
        return one("SELECT " + USER_COLUMNS + " FROM users WHERE id=?", actor().id());
    }
    public void password(Password r) {
        var a = actor(); var row = one("SELECT password FROM users WHERE id=? FOR UPDATE", a.id());
        valid(passwords.matches(r.currentPassword(), (String)row.get("password")), "Mật khẩu hiện tại không đúng");
        valid(r.newPassword().getBytes(StandardCharsets.UTF_8).length<=72,"Mật khẩu vượt quá 72 byte");
        db.update("UPDATE users SET password=? WHERE id=?", passwords.encode(r.newPassword()), a.id());
        audit(a,"CHANGE_PASSWORD","USER",a.id());
    }
    public List<Map<String,Object>> logs(int page) {
        var a = actor(); require(a,"ADMIN"); requirePermission(a, "AUDIT_LOGS", "READ"); valid(page>=0,"Trang không hợp lệ");
        return db.queryForList("SELECT l.*,u.username FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT 100 OFFSET ?", (long)page*100);
    }

    public Map<String,Object> permissions(String requestedRole) {
        var a = actor();
        String role = normalizePermissionValue(requestedRole, ACCOUNT_MANAGEMENT_ROLES, "Role permission không hợp lệ");
        if (a.role().equals("MANAGER") && !a.role().equals(role))
            throw error(HttpStatus.FORBIDDEN, "Manager chỉ được xem permission của chính mình");
        requirePermission(a, "PERMISSION_MANAGEMENT", "READ");

        var rows = db.queryForList(
                "SELECT feature, action, enabled FROM role_permissions WHERE role=? ORDER BY feature, action", role);
        var enabled = new HashMap<String, Boolean>();
        for (var row : rows)
            enabled.put(row.get("feature") + ":" + row.get("action"), Boolean.TRUE.equals(row.get("enabled")));

        var features = new ArrayList<Map<String,Object>>();
        int enabledCount = 0;
        int totalCount = PERMISSION_FEATURES.size() * PERMISSION_ACTIONS.size();
        int restrictedFeatures = 0;
        for (String feature : PERMISSION_FEATURES) {
            var actions = new LinkedHashMap<String, Boolean>();
            int featureEnabled = 0;
            for (String action : PERMISSION_ACTIONS) {
                boolean value = ROLE_PERMISSION_FEATURES.get(role).contains(feature)
                        && Boolean.TRUE.equals(enabled.get(feature + ":" + action));
                actions.put(action, value);
                if (value) {
                    enabledCount++;
                    featureEnabled++;
                }
            }
            if (featureEnabled == 0) restrictedFeatures++;
            var item = new LinkedHashMap<String,Object>();
            item.put("key", feature);
            item.put("label", PERMISSION_LABELS.get(feature));
            item.put("actions", actions);
            features.add(item);
        }

        var result = new LinkedHashMap<String,Object>();
        result.put("role", role);
        result.put("members", count("SELECT COUNT(*) FROM users WHERE role=?", role));
        result.put("enabledPermissions", enabledCount);
        result.put("totalPermissions", totalCount);
        result.put("restrictedFeatures", restrictedFeatures);
        result.put("coverage", totalCount == 0 ? 0 : Math.round(enabledCount * 10000.0 / totalCount) / 100.0);
        result.put("features", features);
        return result;
    }

    public Map<String,Object> updatePermissions(String requestedRole, UpdatePermissions request) {
        var a = actor(); require(a, "ADMIN");
        requirePermission(a, "PERMISSION_MANAGEMENT", "WRITE");
        String role = normalizePermissionValue(requestedRole, ACCOUNT_MANAGEMENT_ROLES, "Role permission không hợp lệ");
        var seen = new HashSet<String>();
        for (var change : request.permissions()) {
            String feature = normalizePermissionValue(change.feature(), new HashSet<>(PERMISSION_FEATURES), "Feature permission không hợp lệ");
            String action = normalizePermissionValue(change.action(), new HashSet<>(PERMISSION_ACTIONS), "Action permission không hợp lệ");
            valid(ROLE_PERMISSION_FEATURES.get(role).contains(feature), "Feature không thuộc phạm vi của role " + role);
            state(seen.add(feature + ":" + action), "Danh sách permission bị trùng");
            if (a.role().equals("ADMIN") && role.equals("ADMIN") && feature.equals("PERMISSION_MANAGEMENT")
                    && (action.equals("READ") || action.equals("WRITE")) && !change.enabled())
                throw error(HttpStatus.CONFLICT, "Không thể tự tắt quyền quản lý permission của Admin đang sử dụng");
            db.update("""
                    UPDATE role_permissions
                    SET enabled=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
                    WHERE role=? AND feature=? AND action=?
                    """, change.enabled(), a.id(), role, feature, action);
        }
        audit(a, "UPDATE_PERMISSIONS", "PERMISSION", null);
        return permissions(role);
    }


    public Map<String,Object> userPermissions(long userId) {
        var a = actor(); require(a, "ADMIN"); requirePermission(a, "PERMISSION_MANAGEMENT", "READ");
        var target = one("SELECT id,username,role,is_active FROM users WHERE id=?", userId);
        String role = normalizeRole(String.valueOf(target.get("role")));
        var inheritedRows = ACCOUNT_MANAGEMENT_ROLES.contains(role) ? db.queryForList("SELECT feature,action,enabled FROM role_permissions WHERE role=?", role) : List.<Map<String,Object>>of();
        var inherited = new HashMap<String,Boolean>();
        for (var row : inheritedRows) inherited.put(row.get("feature") + ":" + row.get("action"), Boolean.TRUE.equals(row.get("enabled")));
        var overrideRows = db.queryForList("SELECT feature,action,enabled FROM user_permission_overrides WHERE user_id=?", userId);
        var overrides = new HashMap<String,Boolean>();
        for (var row : overrideRows) overrides.put(row.get("feature") + ":" + row.get("action"), Boolean.TRUE.equals(row.get("enabled")));
        var features = new ArrayList<Map<String,Object>>();
        for (String feature : PERMISSION_FEATURES) {
            var actions = new LinkedHashMap<String,Object>();
            for (String action : PERMISSION_ACTIONS) {
                String key = feature + ":" + action;
                var value = new LinkedHashMap<String,Object>();
                boolean roleEnabled = Boolean.TRUE.equals(inherited.get(key));
                Boolean overrideEnabled = overrides.get(key);
                value.put("roleEnabled", roleEnabled);
                value.put("overrideEnabled", overrideEnabled);
                value.put("effectiveEnabled", overrideEnabled == null ? roleEnabled : overrideEnabled);
                value.put("source", overrideEnabled == null ? "ROLE" : "CUSTOM");
                actions.put(action, value);
            }
            var item = new LinkedHashMap<String,Object>();
            item.put("key", feature); item.put("label", PERMISSION_LABELS.get(feature)); item.put("actions", actions);
            features.add(item);
        }
        var result = new LinkedHashMap<String,Object>();
        result.put("user", target); result.put("features", features); result.put("customCount", overrides.size());
        return result;
    }

    public Map<String,Object> updateUserPermissions(long userId, UpdateUserPermissions request) {
        var a = actor(); require(a, "ADMIN"); requirePermission(a, "PERMISSION_MANAGEMENT", "WRITE");
        var target = one("SELECT id,username,role FROM users WHERE id=? FOR UPDATE", userId);
        state(a.id() != userId, "Không thể override quyền của chính tài khoản Admin đang sử dụng");
        var seen = new HashSet<String>();
        var changed = new ArrayList<Map<String,Object>>();
        for (var change : request.permissions()) {
            String feature = normalizePermissionValue(change.feature(), new HashSet<>(PERMISSION_FEATURES), "Feature permission không hợp lệ");
            String action = normalizePermissionValue(change.action(), new HashSet<>(PERMISSION_ACTIONS), "Action permission không hợp lệ");
            state(seen.add(feature + ":" + action), "Danh sách permission bị trùng");
            var previous = db.queryForList("SELECT enabled FROM user_permission_overrides WHERE user_id=? AND feature=? AND action=?", userId, feature, action);
            Boolean oldValue = previous.isEmpty() ? null : Boolean.TRUE.equals(previous.getFirst().get("enabled"));
            if (change.enabled() == null) db.update("DELETE FROM user_permission_overrides WHERE user_id=? AND feature=? AND action=?", userId, feature, action);
            else db.update("INSERT INTO user_permission_overrides(user_id,feature,action,enabled,updated_by) VALUES (?,?,?,?,?) ON CONFLICT (user_id,feature,action) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP", userId, feature, action, change.enabled(), a.id());
            if (!Objects.equals(oldValue, change.enabled())) { var item = new LinkedHashMap<String,Object>(); item.put("feature", feature); item.put("action", action); item.put("old", oldValue == null ? "INHERIT" : oldValue); item.put("new", change.enabled() == null ? "INHERIT" : change.enabled()); changed.add(item); }
        }
        audit(a, "UPDATE_USER_PERMISSIONS", "USER", userId, jsonValue(Map.of("username", target.get("username"), "changes", changed)));
        return userPermissions(userId);
    }
    // Managers own their resources. Reviewers see tasks only in their assigned sessions.
    private String taskScope(Actor a) {
        return switch (a.role()) {
            case "MANAGER" -> "t.assigned_by="+a.id();
            // Analysts compare AI runs only. This is enforced at the data boundary,
            // so opening a manually labelled task directly cannot bypass the UI.
            case "RESULT_ANALYST" -> "t.task_type='AI' AND EXISTS (SELECT 1 FROM session_members m WHERE m.session_id=t.session_id AND m.user_id="+a.id()+")";
            case "REVIEWER" -> "t.task_type='MANUAL' AND (EXISTS (SELECT 1 FROM session_members m WHERE m.session_id=t.session_id AND m.user_id="+a.id()+") " +
                    "OR EXISTS (SELECT 1 FROM review_cases rc WHERE rc.assigned_to="+a.id()+" AND t.id IN (rc.left_task_id,rc.right_task_id)))";
            default -> "t.assigned_to="+a.id();
        };
    }
    private boolean canReadTask(Actor a, long taskId) {
        return count("SELECT count(*) FROM annotation_tasks t WHERE t.id=? AND ("+taskScope(a)+")", taskId)>0;
    }
    public List<Map<String,Object>> documents() {
        var a=actor();
        if (a.role().equals("MANAGER")) requirePermission(a, "DOCUMENTS", "READ");
        String scope = a.role().equals("RESULT_ANALYST") ? "1=1" :
                "EXISTS (SELECT 1 FROM annotation_tasks t WHERE t.document_id=d.id AND ("+taskScope(a)+"))";
        if (a.role().equals("MANAGER")) scope="d.uploaded_by="+a.id();
        return db.queryForList("SELECT d.id,d.title,d.original_name,d.document_type,d.status,d.uploaded_by,u.username AS uploaded_by_username,d.file_size,d.content_type,d.created_at FROM documents d JOIN users u ON u.id=d.uploaded_by WHERE "+scope+" AND d.document_type='PDF' ORDER BY d.id DESC");
    }
    public Map<String,Object> document(long documentId) {
        var a=actor(); if (a.role().equals("MANAGER")) requirePermission(a, "DOCUMENTS", "READ");
        var d=one("SELECT * FROM documents WHERE id=?",documentId);
        boolean access=a.role().equals("RESULT_ANALYST") || (a.role().equals("MANAGER") && Objects.equals(a.id(),nullableId(d,"uploaded_by")))
                || count("SELECT count(*) FROM annotation_tasks t WHERE t.document_id=? AND ("+taskScope(a)+")",documentId)>0;
        if (!access) throw error(HttpStatus.FORBIDDEN,"Bạn không có quyền xem tài liệu này");
        return d;
    }
    public Map<String,Object> createDocument(Document r, String originalName, byte[] content) {
        var a=actor(); require(a,"MANAGER"); requirePermission(a, "DOCUMENTS", "WRITE");
        var d=one("INSERT INTO documents(title,original_name,document_type,uploaded_by,file_data,file_size,content_type) VALUES (?,?,'PDF',?,?,?,'application/pdf') RETURNING id,title,original_name,document_type,status,file_size,content_type,created_at",
                r.title(),originalName,a.id(),content,(long)content.length);
        audit(a,"UPLOAD","DOCUMENT",id(d,"id")); return d;
    }
    public void updateDocument(long documentId, Document r) {
        var a=actor(); require(a,"MANAGER"); requirePermission(a, "DOCUMENTS", "WRITE"); owns(a,one("SELECT * FROM documents WHERE id=? FOR UPDATE",documentId),"uploaded_by");
        db.update("UPDATE documents SET title=?,document_type='PDF' WHERE id=?",r.title(),documentId); audit(a,"UPDATE","DOCUMENT",documentId);
    }
    public void deleteDocument(long documentId) {
        var a=actor(); require(a,"MANAGER"); requirePermission(a, "DOCUMENTS", "DELETE"); owns(a,one("SELECT * FROM documents WHERE id=? FOR UPDATE",documentId),"uploaded_by");
        state(count("SELECT count(*) FROM annotation_tasks WHERE document_id=?",documentId)==0,"Tài liệu đã có tác vụ, không thể xóa");
        db.update("DELETE FROM documents WHERE id=?",documentId); audit(a,"DELETE","DOCUMENT",documentId);
    }
    public List<Map<String,Object>> sessions() {
        var a=actor(); require(a,"MANAGER"); requirePermission(a, "SESSIONS", "READ");
        var rows=db.queryForList("SELECT * FROM annotation_sessions WHERE created_by=? ORDER BY id DESC",a.id());
        for(var r:rows) r.put("members",db.queryForList("SELECT u.id,u.username,u.role FROM users u JOIN session_members m ON m.user_id=u.id WHERE m.session_id=? ORDER BY u.username",id(r,"id")));
        return rows;
    }
    private Map<String,Object> ownSession(Actor a,long sessionId) {
        var s=one("SELECT * FROM annotation_sessions WHERE id=? FOR UPDATE",sessionId); owns(a,s,"created_by"); return s;
    }
    @Transactional(rollbackFor = Throwable.class)
    public Map<String,Object> createSession(Session r) {
        var a = actor();
        require(a, "MANAGER");
        requirePermission(a, "SESSIONS", "WRITE");
        valid(r != null, "Dữ liệu phiên không được để trống");
        valid(r.name() != null, "Tên phiên không được để trống");
        String trimmedName = r.name().trim();
        valid(!trimmedName.isBlank(), "Tên phiên không được để trống");
        valid(trimmedName.length() <= 150, "Tên phiên tối đa 150 ký tự");
        valid(r.description() == null || r.description().length() <= 10000, "Mô tả tối đa 10000 ký tự");
        valid(r.sessionType() != null && Set.of("AI", "MANUAL").contains(r.sessionType().trim()), "Loại phiên chỉ cho phép AI hoặc MANUAL");
        String sessionType = r.sessionType().trim();
        valid(r.dueAt() != null && r.dueAt().isAfter(java.time.LocalDateTime.now()), "Thời hạn phiên phải ở thời điểm tương lai");
        String description = r.description() == null ? null : r.description().trim();

        // 1-6. Assignment, role, active, availability validation
        validateSessionAssignment(sessionType, r);

        // 7. Validate documents & assistanceMode consistency before persistence
        List<Long> documentIds = r.documents() == null ? List.of() : r.documents().stream().distinct().toList();
        for (Long docId : documentIds) {
            valid(docId != null, "Document ID không được để trống");
            owns(a, one("SELECT * FROM documents WHERE id=? FOR SHARE", docId), "uploaded_by");
        }
        String assistanceMode = sessionType.equals("AI") ? "AI_ASSISTED" : normalizeAssistanceMode(r.assistanceMode());

        // 8. Collect assigned members
        Set<Long> memberIds = new LinkedHashSet<>();
        if ("MANUAL".equalsIgnoreCase(sessionType)) {
            if (r.manualLabelerIds() != null) memberIds.addAll(r.manualLabelerIds());
            if (r.reviewerId() != null) memberIds.add(r.reviewerId());
        } else if ("AI".equalsIgnoreCase(sessionType)) {
            if (r.aiLabelerId() != null) memberIds.add(r.aiLabelerId());
            if (r.reviewerId() != null) memberIds.add(r.reviewerId());
        }

        // 9. Atomically claim each assigned user: AVAILABLE -> BUSY (concurrency-safe)
        claimAssignedUsers(memberIds);

        // 10. Assign the function selected by the manager to generic USER accounts.
        assignSessionRoles(sessionType, r);

        // 11. Insert annotation_sessions
        var s = one("""
                INSERT INTO annotation_sessions(name, description, session_type, status, due_at, created_by, started_at, ended_at)
                VALUES (?, ?, ?, 'DRAFT', ?, ?, NULL, NULL)
                RETURNING *
                """,
                trimmedName, description, sessionType, r.dueAt(), a.id());
        long sessionId = id(s, "id");
        audit(a, "CREATE", "SESSION", sessionId);

        // 12. Insert session_members
        for (Long userId : memberIds) {
            db.update("INSERT INTO session_members(session_id, user_id) VALUES (?, ?)", sessionId, userId);
        }

        // 13. Create annotation_tasks for documents and labelers
        for (Long docId : documentIds) {
            if ("MANUAL".equalsIgnoreCase(sessionType)) {
                if (r.manualLabelerIds() != null) {
                    for (Long manualId : r.manualLabelerIds()) {
                        var t = one("""
                                INSERT INTO annotation_tasks(document_id, session_id, task_type, assigned_to, assigned_by, due_at, assistance_mode)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                                RETURNING *
                                """,
                                docId, sessionId, "MANUAL", manualId, a.id(), r.dueAt(), assistanceMode);
                        audit(a, "CREATE", "TASK", id(t, "id"));
                    }
                }
            } else if ("AI".equalsIgnoreCase(sessionType)) {
                if (r.aiLabelerId() != null) {
                    var t = one("""
                            INSERT INTO annotation_tasks(document_id, session_id, task_type, assigned_to, assigned_by, due_at, assistance_mode)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            RETURNING *
                            """,
                            docId, sessionId, "AI", r.aiLabelerId(), a.id(), r.dueAt(), "AI_ASSISTED");
                    audit(a, "CREATE", "TASK", id(t, "id"));
                }
            }
        }

        return s;
    }

    private void claimAssignedUsers(Set<Long> userIds) {
        for (Long userId : userIds) {
            int updated = db.update("""
                    UPDATE users
                    SET status = 'BUSY'
                    WHERE id = ?
                      AND status = 'AVAILABLE'
                    """, userId);
            if (updated != 1) {
                var rows = db.queryForList("SELECT id, username, role, is_active FROM users WHERE id=?", userId);
                String identifier = rows.isEmpty() || rows.getFirst().get("username") == null
                        ? String.valueOf(userId)
                        : String.valueOf(rows.getFirst().get("username"));
                throw error(HttpStatus.BAD_REQUEST, "User " + identifier + " is not available: User is currently BUSY and cannot be assigned to a new session.");
            }
        }
    }

    private void assignSessionRoles(String sessionType, Session r) {
        if ("MANUAL".equalsIgnoreCase(sessionType)) {
            for (Long userId : r.manualLabelerIds()) {
                db.update("UPDATE users SET role='MANUAL_LABELER' WHERE id=? AND role='USER'", userId);
            }
            db.update("UPDATE users SET role='REVIEWER' WHERE id=? AND role='USER'", r.reviewerId());
        } else {
            db.update("UPDATE users SET role='AI_LABELER' WHERE id=? AND role='USER'", r.aiLabelerId());
            db.update("UPDATE users SET role='RESULT_ANALYST' WHERE id=? AND role='USER'", r.reviewerId());
        }
    }

    private void validateSessionAssignment(String sessionType, Session r) {
        if ("MANUAL".equalsIgnoreCase(sessionType)) {
            valid(r.manualLabelerIds() != null && r.manualLabelerIds().size() == 2,
                    "Manual session requires exactly 2 manual labelers.");
            valid(r.manualLabelerIds().stream().allMatch(Objects::nonNull),
                    "Manual labeler ID không được để trống");
            valid(r.aiLabelerId() == null,
                    "AI labeler cannot be assigned to a MANUAL session.");
            valid(r.reviewerId() != null,
                    "Reviewer is required.");

            // Duplicate-function validation: all assigned user IDs must be unique
            List<Long> assignedIds = new ArrayList<>(r.manualLabelerIds());
            assignedIds.add(r.reviewerId());
            validateNoDuplicateFunctions(assignedIds);

            // 4. Validate user roles & 5. Validate active users
            for (Long manualId : r.manualLabelerIds()) {
                validateAssignmentUser(manualId, "MANUAL_LABELER");
            }
            validateAssignmentUser(r.reviewerId(), "REVIEWER");

            // 6. Validate previous-session availability
            for (Long manualId : r.manualLabelerIds()) {
                validateUserAvailability(manualId);
            }
            validateUserAvailability(r.reviewerId());
        } else if ("AI".equalsIgnoreCase(sessionType)) {
            valid(r.aiLabelerId() != null,
                    "AI session requires exactly 1 AI labeler.");
            valid(r.manualLabelerIds() == null || r.manualLabelerIds().isEmpty(),
                    "Manual labeler cannot be assigned to an AI session.");
            valid(r.reviewerId() != null,
                    "Reviewer is required.");

            // Duplicate-function validation: all assigned user IDs must be unique
            List<Long> assignedIds = new ArrayList<>();
            assignedIds.add(r.aiLabelerId());
            assignedIds.add(r.reviewerId());
            validateNoDuplicateFunctions(assignedIds);

            // 4. Validate user roles & 5. Validate active users
            validateAssignmentUser(r.aiLabelerId(), "AI_LABELER");
            validateAssignmentUser(r.reviewerId(), "RESULT_ANALYST");

            // 6. Validate previous-session availability
            validateUserAvailability(r.aiLabelerId());
            validateUserAvailability(r.reviewerId());
        }
    }

    private void validateNoDuplicateFunctions(List<Long> assignedUserIds) {
        valid(new HashSet<>(assignedUserIds).size() == assignedUserIds.size(),
                "A user cannot have multiple functions in the same session.");
    }

    private void validateAssignmentUser(Long userId, String expectedRole) {
        valid(userId != null, "User ID không được để trống");
        var rows = db.queryForList("SELECT id, username, role, is_active FROM users WHERE id=?", userId);
        valid(!rows.isEmpty(), "User " + userId + " không tồn tại");
        var u = rows.getFirst();
        String identifier = u.get("username") != null ? String.valueOf(u.get("username")) : String.valueOf(userId);
        valid(Objects.equals(u.get("role"), expectedRole) || Objects.equals(u.get("role"), "USER"),
                "User " + identifier + " must have role USER or " + expectedRole + ".");
        valid(Boolean.TRUE.equals(u.get("is_active")), "User " + identifier + " is inactive.");
    }

    public boolean isUserAvailable(long userId) {
        var rows = db.queryForList("SELECT status FROM users WHERE id=?", userId);
        if (rows.isEmpty()) {
            return false;
        }
        Object status = rows.getFirst().get("status");
        return "AVAILABLE".equalsIgnoreCase(status != null ? status.toString() : "");
    }

    public void validateUserAvailability(Long userId) {
        if (!isUserAvailable(userId)) {
            var rows = db.queryForList("SELECT id, username, role, is_active FROM users WHERE id=?", userId);
            String identifier = rows.isEmpty() || rows.getFirst().get("username") == null
                    ? String.valueOf(userId)
                    : String.valueOf(rows.getFirst().get("username"));
            throw error(HttpStatus.BAD_REQUEST, "User " + identifier + " is not available: User is currently BUSY and cannot be assigned to a new session.");
        }
    }
    private LocalDateTime toLocalDateTime(Object value) {
        if (value == null) return null;
        if (value instanceof LocalDateTime ldt) return ldt;
        if (value instanceof java.sql.Timestamp ts) return ts.toLocalDateTime();
        if (value instanceof java.time.OffsetDateTime odt) return odt.toLocalDateTime();
        if (value instanceof java.time.ZonedDateTime zdt) return zdt.toLocalDateTime();
        if (value instanceof java.time.Instant instant) return LocalDateTime.ofInstant(instant, java.time.ZoneId.systemDefault());
        return LocalDateTime.parse(value.toString());
    }

    public void members(long sessionId, Members r) {
        var a=actor();require(a,"MANAGER"); requirePermission(a, "SESSIONS", "WRITE"); var s=ownSession(a,sessionId); state(!s.get("status").equals("CLOSED"),"Phiên đã đóng");
        long existing=count("SELECT count(*) FROM session_members WHERE session_id=?",sessionId);
        if (existing>0 && java.time.LocalDateTime.now().isBefore(toLocalDateTime(s.get("due_at"))))
            throw error(HttpStatus.CONFLICT,"Chỉ được thay đổi thành viên sau ngày hết hạn");
        var requested=new HashSet<>(r.userIds());
        for(long userId:requested) {
            var u=one("SELECT role,is_active FROM users WHERE id=? FOR SHARE",userId);
            valid(Boolean.TRUE.equals(u.get("is_active")) && Set.of("AI_LABELER","MANUAL_LABELER","REVIEWER","RESULT_ANALYST").contains(u.get("role")),"Thành viên phải là user đang hoạt động với vai trò hợp lệ");
            valid(count("SELECT count(*) FROM session_members m JOIN annotation_sessions s ON s.id=m.session_id WHERE m.user_id=? AND m.session_id<>? AND s.status IN ('DRAFT','ACTIVE')",userId,sessionId)==0,"Mỗi người chỉ được tham gia một session đang hoạt động");
        }
        for(var t:db.queryForList("SELECT assigned_to FROM annotation_tasks WHERE session_id=? AND assigned_to IS NOT NULL AND status<>'APPROVED'",sessionId))
            state(requested.contains(id(t,"assigned_to")),"Không thể bỏ thành viên còn tác vụ chưa hoàn tất");
        db.update("DELETE FROM session_members WHERE session_id=?",sessionId);
        for(long userId:requested) db.update("INSERT INTO session_members(session_id,user_id) VALUES (?,?)",sessionId,userId);
        audit(a,"UPDATE_MEMBERS","SESSION",sessionId);
    }
    public void sessionState(long sessionId, State r) {
        var a=actor();require(a,"MANAGER");requirePermission(a, "SESSIONS", "EXECUTE");var s=ownSession(a,sessionId);
        state((s.get("status").equals("DRAFT") && r.status().equals("ACTIVE")) || (s.get("status").equals("ACTIVE") && r.status().equals("CLOSED")),"Chỉ chuyển DRAFT → ACTIVE → CLOSED");
        if(r.status().equals("CLOSED")) state(count("SELECT count(*) FROM annotation_tasks WHERE session_id=? AND status<>'APPROVED'",sessionId)==0,"Còn tác vụ chưa được duyệt");
        db.update("UPDATE annotation_sessions SET status=?,started_at=CASE WHEN ?='ACTIVE' THEN CURRENT_TIMESTAMP ELSE started_at END,ended_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE ended_at END WHERE id=?",r.status(),r.status(),r.status(),sessionId);
        audit(a,"STATUS_"+r.status(),"SESSION",sessionId);
        if ("CLOSED".equals(r.status())) {
            releaseAssignedUsers(sessionId);
        }
    }

    private void releaseAssignedUsers(long sessionId) {
        db.update("""
                UPDATE users u
                SET status = 'AVAILABLE'
                WHERE u.id IN (
                    SELECT sm.user_id
                    FROM session_members sm
                    WHERE sm.session_id = ?
                )
                  AND u.status = 'BUSY'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM session_members other_sm
                    JOIN annotation_sessions other_s
                      ON other_s.id = other_sm.session_id
                    WHERE other_sm.user_id = u.id
                      AND other_sm.session_id <> ?
                      AND other_s.status <> 'CLOSED'
                )
                """, sessionId, sessionId);
    }
    public List<Map<String,Object>> tasks() { return tasks(null,null,null,null,null); }
    public List<Map<String,Object>> tasks(String type, String status, Long sessionId, String due, String search) {
        var a=actor(); if (a.role().equals("MANAGER")) requirePermission(a, "TASKS", "READ");
        StringBuilder sql=new StringBuilder("SELECT t.*,t.id AS task_id,d.title AS document_title,u.username AS assignee,s.name AS session_name, " +
                "s.started_at AS session_started_at, " +
                "(SELECT count(*) FROM ai_labeler_results ar WHERE ar.task_id=t.id) AS result_count " +
                "FROM annotation_tasks t JOIN documents d ON d.id=t.document_id LEFT JOIN users u ON u.id=t.assigned_to " +
                "LEFT JOIN annotation_sessions s ON s.id=t.session_id WHERE "+taskScope(a));
        var args=new ArrayList<Object>();
        if(type!=null&&!type.isBlank()) { valid(Set.of("AI","MANUAL").contains(type.toUpperCase()),"Loại tác vụ không hợp lệ"); sql.append(" AND t.task_type=?"); args.add(type.toUpperCase()); }
        if(status!=null&&!status.isBlank()) { sql.append(" AND t.status=?"); args.add(status.toUpperCase()); }
        if(sessionId!=null) { sql.append(" AND t.session_id=?"); args.add(sessionId); }
        if("OVERDUE".equalsIgnoreCase(due)) sql.append(" AND t.due_at IS NOT NULL AND t.due_at < CURRENT_TIMESTAMP AND t.status NOT IN ('APPROVED','REJECTED')");
        if("UPCOMING".equalsIgnoreCase(due)) sql.append(" AND (t.due_at IS NULL OR t.due_at >= CURRENT_TIMESTAMP)");
        if(search!=null&&!search.isBlank()) { sql.append(" AND (LOWER(d.title) LIKE LOWER(?) OR LOWER(d.original_name) LIKE LOWER(?))"); String q="%"+search.trim()+"%"; args.add(q);args.add(q); }
        sql.append(" ORDER BY t.due_at NULLS LAST, t.id DESC");
        return db.queryForList(sql.toString(),args.toArray());
    }
    public Map<String,Object> task(long taskId) {
        var a=actor(); if (a.role().equals("MANAGER")) requirePermission(a, "TASKS", "READ");
        var t=one("SELECT t.*,d.title AS document_title FROM annotation_tasks t JOIN documents d ON d.id=t.document_id WHERE t.id=?",taskId);
        if(!canReadTask(a,taskId)) throw error(HttpStatus.FORBIDDEN,"Bạn không được phân công tác vụ này");
        t.put("labels",db.queryForList("SELECT * FROM annotations WHERE task_id=? ORDER BY id",taskId));
        t.put("reviews",db.queryForList("SELECT r.*,u.username AS reviewer FROM review_decisions r JOIN users u ON u.id=r.reviewed_by WHERE task_id=?",taskId));return t;
    }
    public List<Map<String,Object>> aiResults(long taskId) {
        var a=actor();
        if (!canReadTask(a, taskId)) throw error(HttpStatus.FORBIDDEN, "Bạn không được xem kết quả của tác vụ này");
        return db.queryForList("""
                SELECT id, run_id, task_id, document_id, provider, model, indicator_name,
                       indicator_value, unit, source_page, source_label, confidence,
                       created_by_username, created_at
                FROM ai_labeler_results
                WHERE task_id=?
                UNION ALL
                SELECT id, run_id, task_id, document_id, provider, model, indicator_name,
                       indicator_value, unit, source_page, source_label, confidence,
                       created_by_username, created_at
                FROM manual_labeler_results
                WHERE task_id=?
                ORDER BY created_at DESC, id DESC
                """, taskId, taskId);
    }
    private void validAssignee(String type, Long sessionId, long userId) {
        var u=one("SELECT role,is_active FROM users WHERE id=? FOR SHARE",userId);
        valid(Boolean.TRUE.equals(u.get("is_active")) && Objects.equals(u.get("role"),type.equals("AI")?"AI_LABELER":"MANUAL_LABELER"),"Người nhận phải đang hoạt động và đúng vai trò gán nhãn");
        if(sessionId!=null) valid(count("SELECT count(*) FROM session_members WHERE session_id=? AND user_id=?",sessionId,userId)>0,"Người nhận chưa thuộc phiên này");
    }
    public Map<String,Object> createTask(Task r) {
        var a=actor();require(a,"MANAGER");requirePermission(a, "TASKS", "WRITE");valid(Set.of("AI","MANUAL").contains(r.taskType()),"Loại tác vụ không hợp lệ");
        owns(a,one("SELECT * FROM documents WHERE id=? FOR SHARE",r.documentId()),"uploaded_by");
        if(r.sessionId()!=null) {
            var s=ownSession(a,r.sessionId());state(!s.get("status").equals("CLOSED"),"Phiên đã đóng");
            valid(Objects.equals(s.get("session_type"), r.taskType()),"Loại tác vụ không phù hợp với phiên");
        }
        if(r.assignedTo()!=null) validAssignee(r.taskType(),r.sessionId(),r.assignedTo());
        String assistanceMode=r.taskType().equals("AI")?"AI_ASSISTED":normalizeAssistanceMode(r.assistanceMode());
        var t=one("INSERT INTO annotation_tasks(document_id,session_id,task_type,assigned_to,assigned_by,due_at,assistance_mode) VALUES (?,?,?,?,?,?,?) RETURNING *",r.documentId(),r.sessionId(),r.taskType(),r.assignedTo(),a.id(),r.dueAt(),assistanceMode);
        audit(a,"CREATE","TASK",id(t,"id"));return t;
    }
    private static String normalizeAssistanceMode(String value) {
        String normalized=value==null||value.isBlank()?"NONE":value.trim().toUpperCase(Locale.ROOT);
        if(!Set.of("NONE","AI_ASSISTED").contains(normalized)) throw error(HttpStatus.BAD_REQUEST,"Chế độ hỗ trợ chỉ cho phép NONE hoặc AI_ASSISTED");
        return normalized;
    }
    public void assign(long taskId,Assignment r) {
        var a=actor();require(a,"MANAGER");requirePermission(a, "TASKS", "WRITE");var t=one("SELECT * FROM annotation_tasks WHERE id=? FOR UPDATE",taskId);owns(a,t,"assigned_by");
        state(t.get("status").equals("PENDING"),"Chỉ phân công lại tác vụ chưa bắt đầu");
        validAssignee((String)t.get("task_type"),nullableId(t,"session_id"),r.userId());
        db.update("UPDATE annotation_tasks SET assigned_to=? WHERE id=?",r.userId(),taskId);audit(a,"ASSIGN","TASK",taskId);
    }
    private Map<String,Object> writableTask(Actor a,long taskId) {
        require(a,"AI_LABELER","MANUAL_LABELER");var t=one("SELECT * FROM annotation_tasks WHERE id=? FOR UPDATE",taskId);owns(a,t,"assigned_to");
        valid(t.get("task_type").equals(a.role().equals("AI_LABELER")?"AI":"MANUAL"),"Vai trò không phù hợp với tác vụ");
        if(t.get("session_id")!=null) {
            var s=one("SELECT status FROM annotation_sessions WHERE id=? FOR SHARE",t.get("session_id"));
            state(s.get("status").equals("ACTIVE"),"Phiên cần ở trạng thái ACTIVE để làm việc");
        }
        return t;
    }
    public void start(long taskId) {
        var a=actor();var t=writableTask(a,taskId);state(Set.of("PENDING","REJECTED").contains(t.get("status")),"Không thể bắt đầu ở trạng thái hiện tại");
        db.update("UPDATE annotation_tasks SET status='IN_PROGRESS',completed_at=NULL WHERE id=?",taskId);audit(a,"START","TASK",taskId);
    }
    public void labels(long taskId, Labels r) {
        var a=actor();var t=writableTask(a,taskId);state(t.get("status").equals("IN_PROGRESS"),"Hãy bắt đầu tác vụ trước khi lưu nhãn");
        db.update("DELETE FROM annotations WHERE task_id=?",taskId);
        db.update("DELETE FROM task_section_progress WHERE task_id=? AND status<>'REVIEWED'",taskId);
        for(var l:r.labels()) {
            String key=fieldKey(l.labelName());
            db.update("INSERT INTO annotations(task_id,label_name,label_value,source_page,confidence,source_bbox,created_by) VALUES (?,?,?,?,?,CAST(? AS jsonb),?)",
                    taskId,l.labelName().trim(),l.labelValue(),l.sourcePage(),l.confidence(),json(l.sourceBbox()),a.id());
            db.update("""
                    INSERT INTO task_section_progress(task_id,field_key,field_name,status,started_at,saved_at)
                    VALUES (?,?,?,'SAVED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                    ON CONFLICT (task_id,field_key) DO UPDATE SET field_name=EXCLUDED.field_name,status='SAVED',
                    started_at=COALESCE(task_section_progress.started_at,CURRENT_TIMESTAMP),saved_at=CURRENT_TIMESTAMP
                    """,taskId,key,l.labelName().trim());
        }
        audit(a,"SAVE_LABELS","TASK",taskId);
    }
    public void submit(long taskId) {
        var a=actor();var t=writableTask(a,taskId);state(t.get("status").equals("IN_PROGRESS"),"Tác vụ chưa ở trạng thái đang làm");
        state(count("SELECT count(*) FROM annotations WHERE task_id=?",taskId)>0,"Cần ít nhất một nhãn trước khi nộp");
        requireAllDone(labelerCompletion(a,nullableId(t,"session_id")),"Chưa thể Submit Task");
        db.update("UPDATE annotation_tasks SET status='SUBMITTED',completed_at=CURRENT_TIMESTAMP WHERE id=?",taskId);
        db.update("UPDATE task_section_progress SET status='SUBMITTED',submitted_at=CURRENT_TIMESTAMP WHERE task_id=?",taskId);
        audit(a,"SUBMIT","TASK",taskId);
    }

    public Map<String,Object> sectionState(long taskId,String requestedFieldKey,SectionState r) {
        var a=actor();var t=writableTask(a,taskId);
        state(Set.of("PENDING","REJECTED","IN_PROGRESS").contains(String.valueOf(t.get("status"))),"Không thể cập nhật section ở trạng thái hiện tại");
        String key=fieldKey(requestedFieldKey);
        var row=one("""
                INSERT INTO task_section_progress(task_id,field_key,field_name,status,started_at)
                VALUES (?,?,?,'IN_PROGRESS',CURRENT_TIMESTAMP)
                ON CONFLICT (task_id,field_key) DO UPDATE SET status=CASE WHEN task_section_progress.status='NOT_STARTED' THEN 'IN_PROGRESS' ELSE task_section_progress.status END,
                started_at=COALESCE(task_section_progress.started_at,CURRENT_TIMESTAMP)
                RETURNING *
                """,taskId,key,requestedFieldKey.trim());
        return row;
    }
    public void review(long taskId, Review r) {
        var a=actor();require(a,"REVIEWER");valid(Set.of("APPROVED","REJECTED").contains(r.decision()),"Quyết định không hợp lệ");
        valid(!r.decision().equals("REJECTED") || (r.feedback()!=null && !r.feedback().isBlank()),"Cần phản hồi khi từ chối");
        var t=one("SELECT * FROM annotation_tasks WHERE id=? FOR UPDATE",taskId);
        if(!canReadTask(a,taskId) || Objects.equals(a.id(),nullableId(t,"assigned_to"))) throw error(HttpStatus.FORBIDDEN,"Không được duyệt tác vụ này");
        state(t.get("status").equals("SUBMITTED"),"Chỉ duyệt kết quả đã nộp");
        db.update("INSERT INTO review_decisions(task_id,decision,feedback,reviewed_by) VALUES (?,?,?,?) ON CONFLICT (task_id) DO UPDATE SET decision=EXCLUDED.decision,feedback=EXCLUDED.feedback,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=CURRENT_TIMESTAMP",taskId,r.decision(),r.feedback(),a.id());
        db.update("UPDATE annotation_tasks SET status=? WHERE id=?",r.decision(),taskId);audit(a,"REVIEW_"+r.decision(),"TASK",taskId);
    }

    private static String fieldKey(String value) {
        String key=value==null?"":value.trim().replaceAll("\\s+","_").toUpperCase(Locale.ROOT);
        if(key.isBlank()||key.length()>150) throw error(HttpStatus.BAD_REQUEST,"Tên section không hợp lệ");
        return key;
    }
    private static String json(Map<String,Object> value) {
        if(value==null||value.isEmpty()) return null;
        try { return JSON.writeValueAsString(value); }
        catch(JsonProcessingException exception) { throw error(HttpStatus.BAD_REQUEST,"Tọa độ vùng nguồn không hợp lệ"); }
    }
    private static String jsonValue(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch(JsonProcessingException exception) { throw error(HttpStatus.BAD_REQUEST,"Dữ liệu JSON không hợp lệ"); }
    }
    private static <T> T readJson(Object value, Class<T> type, T fallback) {
        if (value == null) return fallback;
        try { return JSON.readValue(String.valueOf(value), type); }
        catch (JsonProcessingException exception) { return fallback; }
    }
    private Map<String,Object> accessibleReviewCase(Actor a,long reviewCaseId,boolean lock) {
        String suffix=lock?" FOR UPDATE OF rc":"";
        var row=one("""
                SELECT rc.*,d.title AS document_title,d.original_name,
                       lu.username AS left_assignee,ru.username AS right_assignee,
                       lt.task_type AS left_task_type,rt.task_type AS right_task_type,
                       lt.session_id AS left_session_id,rt.session_id AS right_session_id,
                       reviewer.username AS reviewer
                FROM review_cases rc
                JOIN documents d ON d.id=rc.document_id
                JOIN annotation_tasks lt ON lt.id=rc.left_task_id
                JOIN annotation_tasks rt ON rt.id=rc.right_task_id
                LEFT JOIN users lu ON lu.id=lt.assigned_to
                LEFT JOIN users ru ON ru.id=rt.assigned_to
                JOIN users reviewer ON reviewer.id=rc.assigned_to
                WHERE rc.id=?
                  AND lt.task_type='MANUAL' AND rt.task_type='MANUAL'
                  AND lt.session_id IS NOT NULL AND lt.session_id=rt.session_id
                  AND lu.role='MANUAL_LABELER' AND ru.role='MANUAL_LABELER'
                  AND EXISTS (SELECT 1 FROM session_members sm WHERE sm.session_id=lt.session_id AND sm.user_id=rc.assigned_to)
                """+suffix,reviewCaseId);
        boolean allowed=(a.role().equals("REVIEWER")&&Objects.equals(a.id(),nullableId(row,"assigned_to")))
                ||(a.role().equals("MANAGER")&&Objects.equals(a.id(),nullableId(row,"created_by")));
        if(!allowed) throw error(HttpStatus.FORBIDDEN,"Bạn không được truy cập review case này");
        return row;
    }

    public Map<String,Object> startWorkTime(WorkTimeStart r) {
        var a=actor();require(a,"AI_LABELER","MANUAL_LABELER","REVIEWER");
        valid((r.taskId()!=null)^(r.reviewCaseId()!=null),"Chỉ được chọn taskId hoặc reviewCaseId");
        if(r.taskId()!=null) {
            require(a,"AI_LABELER","MANUAL_LABELER");
            var task=one("SELECT assigned_to,status FROM annotation_tasks WHERE id=?",r.taskId());
            owns(a,task,"assigned_to");
            state(!Set.of("SUBMITTED","APPROVED").contains(String.valueOf(task.get("status"))),"Tác vụ đã hoàn tất");
        } else {
            require(a,"REVIEWER");
            var review=accessibleReviewCase(a,r.reviewCaseId(),true);
            state(!"COMPLETED".equals(review.get("status")),"Review case đã hoàn tất");
            if("PENDING".equals(review.get("status")))
                db.update("UPDATE review_cases SET status='IN_PROGRESS',started_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE id=?",r.reviewCaseId());
        }
        var active=db.queryForList("SELECT * FROM work_time_entries WHERE user_id=? AND task_id IS NOT DISTINCT FROM ? AND review_case_id IS NOT DISTINCT FROM ? AND ended_at IS NULL FOR UPDATE",a.id(),r.taskId(),r.reviewCaseId());
        if(!active.isEmpty()) return active.getFirst();
        return one("INSERT INTO work_time_entries(task_id,review_case_id,user_id,role_snapshot) VALUES (?,?,?,?) RETURNING *",r.taskId(),r.reviewCaseId(),a.id(),a.role());
    }

    public Map<String,Object> heartbeat(long entryId) {
        var a=actor();require(a,"AI_LABELER","MANUAL_LABELER","REVIEWER");
        var entry=one("SELECT * FROM work_time_entries WHERE id=? FOR UPDATE",entryId);owns(a,entry,"user_id");
        state(entry.get("ended_at")==null,"Lượt đo thời gian đã kết thúc");
        LocalDateTime last=toLocalDateTime(entry.get("last_heartbeat_at"));
        long delta=Math.max(0,Math.min(45,Duration.between(last,LocalDateTime.now()).getSeconds()));
        return one("UPDATE work_time_entries SET active_seconds=active_seconds+?,last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *",delta,entryId);
    }

    public Map<String,Object> stopWorkTime(long entryId,WorkTimeStop r) {
        var a=actor();require(a,"AI_LABELER","MANUAL_LABELER","REVIEWER");
        var entry=one("SELECT * FROM work_time_entries WHERE id=? FOR UPDATE",entryId);owns(a,entry,"user_id");
        if(entry.get("ended_at")!=null) return entry;
        LocalDateTime last=toLocalDateTime(entry.get("last_heartbeat_at"));
        long delta=Math.max(0,Math.min(45,Duration.between(last,LocalDateTime.now()).getSeconds()));
        return one("UPDATE work_time_entries SET active_seconds=active_seconds+?,last_heartbeat_at=CURRENT_TIMESTAMP,ended_at=CURRENT_TIMESTAMP,stop_reason=? WHERE id=? RETURNING *",delta,r.reason(),entryId);
    }

    public List<Map<String,Object>> reviewCases(String requestedStatus) {
        var a=actor();require(a,"MANAGER","REVIEWER");
        if(a.role().equals("MANAGER")) requirePermission(a,"TASKS","READ");
        String status=requestedStatus==null?null:requestedStatus.trim().toUpperCase(Locale.ROOT);
        if(status!=null&&!status.isBlank()) valid(Set.of("PENDING","IN_PROGRESS","COMPLETED").contains(status),"Trạng thái review case không hợp lệ");
        String owner=a.role().equals("MANAGER")?"rc.created_by=?":"rc.assigned_to=?";
        var args=new ArrayList<Object>();args.add(a.id());
        String filter="";
        if(status!=null&&!status.isBlank()){filter=" AND rc.status=?";args.add(status);}
        var rows = db.queryForList("""
                SELECT rc.*,d.title AS document_title,d.original_name,
                       lu.username AS left_assignee,ru.username AS right_assignee,
                       lt.task_type AS left_task_type,rt.task_type AS right_task_type,
                       reviewer.username AS reviewer,
                       (SELECT count(*) FROM review_field_decisions fd WHERE fd.review_case_id=rc.id AND fd.final_value IS NOT NULL) AS resolved_fields
                FROM review_cases rc
                JOIN documents d ON d.id=rc.document_id
                JOIN annotation_tasks lt ON lt.id=rc.left_task_id
                JOIN annotation_tasks rt ON rt.id=rc.right_task_id
                LEFT JOIN users lu ON lu.id=lt.assigned_to
                LEFT JOIN users ru ON ru.id=rt.assigned_to
                JOIN users reviewer ON reviewer.id=rc.assigned_to
                """+" WHERE "+owner+filter+
                " AND lt.task_type='MANUAL' AND rt.task_type='MANUAL'"+
                " AND lt.session_id IS NOT NULL AND lt.session_id=rt.session_id"+
                " AND lu.role='MANUAL_LABELER' AND ru.role='MANUAL_LABELER'"+
                " AND EXISTS (SELECT 1 FROM session_members sm WHERE sm.session_id=lt.session_id AND sm.user_id=rc.assigned_to)"+
                " ORDER BY rc.due_at NULLS LAST,rc.id DESC",args.toArray());
        if (a.role().equals("REVIEWER") && (status == null || status.isBlank())) {
            var assigned = db.queryForList("""
                    SELECT t.id,t.session_id,t.document_id,t.status,d.title AS document_title,
                           u.username AS assignee
                    FROM annotation_tasks t
                    JOIN documents d ON d.id=t.document_id
                    JOIN users u ON u.id=t.assigned_to
                    WHERE t.task_type='MANUAL'
                      AND u.role='MANUAL_LABELER'
                      AND t.status IN ('SUBMITTED','APPROVED')
                      AND EXISTS (SELECT 1 FROM session_members sm WHERE sm.session_id=t.session_id AND sm.user_id=? )
                    ORDER BY t.session_id,t.document_id,t.id
                    """, a.id());
            var groups = new LinkedHashMap<String,List<Map<String,Object>>>();
            for (var task : assigned) groups.computeIfAbsent(String.valueOf(task.get("session_id"))+":"+task.get("document_id"), key -> new ArrayList<>()).add(task);
            var existingPairs = rows.stream().map(row -> String.valueOf(row.get("left_task_id"))+":"+row.get("right_task_id")).collect(Collectors.toSet());
            for (var group : groups.values()) if (group.size() >= 2) {
                var left = group.get(0); var right = group.get(1);
                String pair = String.valueOf(left.get("id"))+":"+right.get("id");
                String reverse = String.valueOf(right.get("id"))+":"+left.get("id");
                if (existingPairs.contains(pair) || existingPairs.contains(reverse)) continue;
                var synthetic = new LinkedHashMap<String,Object>();
                synthetic.put("id", -Math.abs(((Number)left.get("id")).longValue()));
                synthetic.put("left_task_id", left.get("id")); synthetic.put("right_task_id", right.get("id"));
                synthetic.put("document_id", left.get("document_id")); synthetic.put("document_title", left.get("document_title"));
                synthetic.put("left_assignee", left.get("assignee")); synthetic.put("right_assignee", right.get("assignee"));
                synthetic.put("status", "PENDING"); synthetic.put("resolved_fields", 0);
                rows.add(synthetic);
            }
        }
        return rows;
    }

    public Map<String,Object> createReviewCase(ReviewCaseCreate r) {
        var a=actor();require(a,"MANAGER");requirePermission(a,"TASKS","WRITE");
        valid(!r.leftTaskId().equals(r.rightTaskId()),"Hai nguồn review phải là hai task khác nhau");
        var left=one("SELECT * FROM annotation_tasks WHERE id=? FOR SHARE",r.leftTaskId());
        var right=one("SELECT * FROM annotation_tasks WHERE id=? FOR SHARE",r.rightTaskId());
        owns(a,left,"assigned_by");owns(a,right,"assigned_by");
        valid(Objects.equals(nullableId(left,"document_id"),nullableId(right,"document_id")),"Hai task phải thuộc cùng tài liệu");
        valid("MANUAL".equals(left.get("task_type")) && "MANUAL".equals(right.get("task_type")),"Review case chỉ được tạo từ task Manual");
        Long leftSession=nullableId(left,"session_id"), rightSession=nullableId(right,"session_id");
        valid(leftSession!=null && Objects.equals(leftSession,rightSession),"Hai task phải thuộc cùng một phiên Manual");
        valid(!Objects.equals(nullableId(left,"assigned_to"),nullableId(right,"assigned_to")),"Hai nguồn review phải do hai Manual Labeler khác nhau nộp");
        valid(count("SELECT count(*) FROM session_members sm JOIN users u ON u.id=sm.user_id WHERE sm.session_id=? AND u.role='MANUAL_LABELER'",leftSession)==2,
                "Phiên Manual phải có đúng 2 manual labeler");
        valid(count("SELECT count(*) FROM session_members sm JOIN users u ON u.id=sm.user_id WHERE sm.session_id=? AND u.role='REVIEWER' AND sm.user_id=?",leftSession,r.assignedTo())==1,
                "Reviewer phải được giao trong cùng phiên Manual");
        valid(count("SELECT count(*) FROM session_members WHERE session_id=? AND user_id IN (?,?)",leftSession,nullableId(left,"assigned_to"),nullableId(right,"assigned_to"))==2,
                "Hai nguồn review phải là hai manual labeler của phiên");
        state(Set.of("SUBMITTED","APPROVED").contains(String.valueOf(left.get("status")))&&Set.of("SUBMITTED","APPROVED").contains(String.valueOf(right.get("status"))),"Hai task phải được nộp trước khi tạo review case");
        var reviewer=one("SELECT role,is_active FROM users WHERE id=?",r.assignedTo());
        valid("REVIEWER".equals(reviewer.get("role"))&&Boolean.TRUE.equals(reviewer.get("is_active")),"Người nhận phải là Reviewer đang hoạt động");
        var row=one("INSERT INTO review_cases(document_id,left_task_id,right_task_id,assigned_to,created_by,due_at) VALUES (?,?,?,?,?,?) RETURNING *",nullableId(left,"document_id"),r.leftTaskId(),r.rightTaskId(),r.assignedTo(),a.id(),r.dueAt());
        audit(a,"CREATE","REVIEW_CASE",id(row,"id"));return row;
    }

    public Map<String,Object> reviewCase(long reviewCaseId) {
        var a=actor();require(a,"MANAGER","REVIEWER");
        if (reviewCaseId < 0) return directReviewComparison(a, -reviewCaseId);
        var review=accessibleReviewCase(a,reviewCaseId,false);
        long leftId=nullableId(review,"left_task_id"),rightId=nullableId(review,"right_task_id");
        var left=annotationMap(leftId);var right=annotationMap(rightId);
        var decisions=new HashMap<String,Map<String,Object>>();
        for(var row:db.queryForList("SELECT * FROM review_field_decisions WHERE review_case_id=? ORDER BY id",reviewCaseId)) decisions.put(String.valueOf(row.get("field_key")),row);
        var keys=new TreeSet<String>();keys.addAll(left.keySet());keys.addAll(right.keySet());
        var fields=new ArrayList<Map<String,Object>>();
        for(String key:keys) fields.add(comparisonField(key,left.get(key),right.get(key),decisions.get(key)));
        review.put("fields",fields);
        review.put("history",db.queryForList("SELECT fd.*,u.username AS reviewer FROM review_field_decisions fd LEFT JOIN users u ON u.id=fd.reviewed_by WHERE fd.review_case_id=? ORDER BY fd.reviewed_at DESC NULLS LAST,fd.id DESC",reviewCaseId));
        return review;
    }

    private Map<String,Object> directReviewComparison(Actor a, long taskId) {
        var task = one("SELECT t.*,d.title AS document_title,u.username AS assignee FROM annotation_tasks t JOIN documents d ON d.id=t.document_id JOIN users u ON u.id=t.assigned_to WHERE t.id=?", taskId);
        valid(canReadTask(a, taskId), "Bạn không được xem tác vụ này");
        var pair = one("""
                SELECT t.*,d.title AS document_title,u.username AS assignee
                FROM annotation_tasks t JOIN documents d ON d.id=t.document_id JOIN users u ON u.id=t.assigned_to
                WHERE t.task_type='MANUAL' AND t.session_id=? AND t.document_id=? AND t.id<>?
                  AND t.status IN ('SUBMITTED','APPROVED')
                ORDER BY t.id LIMIT 1
                """, task.get("session_id"), task.get("document_id"), taskId);
        var leftId = taskId; var rightId = id(pair,"id");
        var left = annotationMap(leftId); var right = annotationMap(rightId);
        var keys = new TreeSet<String>(); keys.addAll(left.keySet()); keys.addAll(right.keySet());
        var fields = new ArrayList<Map<String,Object>>();
        for (String key : keys) fields.add(comparisonField(key,left.get(key),right.get(key),null));
        var review = new LinkedHashMap<String,Object>();
        review.put("id", -Math.abs(taskId)); review.put("left_task_id", leftId); review.put("right_task_id", rightId);
        review.put("document_id", task.get("document_id")); review.put("document_title", task.get("document_title"));
        review.put("left_assignee", task.get("assignee")); review.put("right_assignee", pair.get("assignee"));
        review.put("left_status", task.get("status")); review.put("right_status", pair.get("status"));
        review.put("status", "PENDING"); review.put("fields", fields); review.put("history", List.of());
        return review;
    }

    private Map<String,Map<String,Object>> annotationMap(long taskId) {
        var result=new LinkedHashMap<String,Map<String,Object>>();
        for(var row:db.queryForList("""
                SELECT n.id,n.label_name,n.label_value,n.source_page,n.confidence,n.source_bbox::text AS source_bbox
                FROM annotations n
                JOIN annotation_tasks t ON t.id=n.task_id
                JOIN users u ON u.id=t.assigned_to
                WHERE n.task_id=? AND t.task_type='MANUAL'
                  AND u.role='MANUAL_LABELER' AND n.created_by=t.assigned_to
                ORDER BY n.id
                """,taskId)) result.put(fieldKey(String.valueOf(row.get("label_name"))),row);
        return result;
    }
    private Map<String,Object> comparisonField(String key,Map<String,Object> left,Map<String,Object> right,Map<String,Object> decision) {
        String leftValue=left==null?null:(String)left.get("label_value"),rightValue=right==null?null:(String)right.get("label_value");
        String type=comparisonType(leftValue,rightValue);
        var field=new LinkedHashMap<String,Object>();
        field.put("fieldKey",key);field.put("fieldName",left!=null?left.get("label_name"):right.get("label_name"));field.put("comparisonType",type);
        field.put("left",left);field.put("right",right);
        if(decision!=null){field.put("finalValue",decision.get("final_value"));field.put("selectedSource",decision.get("selected_source"));field.put("feedback",decision.get("feedback"));}
        else if("EXACT".equals(type)){field.put("finalValue",leftValue);field.put("selectedSource","AUTO");}
        return field;
    }
    private static String comparisonType(String left,String right) {
        if(left==null||right==null) return "MISSING";
        String a=normalizeValue(left),b=normalizeValue(right);
        if(a.equals(b)) return "EXACT";
        return canonicalValue(a).equals(canonicalValue(b))?"FORMAT_ONLY":"VALUE_DIFFERENT";
    }
    private static String normalizeValue(String value) { return value.trim().replaceAll("\\s+"," ").toLowerCase(Locale.ROOT); }
    private static String canonicalValue(String value) {
        String grouped=value.replaceAll("(?<=\\d)[.,](?=\\d{3}(?:\\D|$))","");
        return grouped.replace(',','.').replaceAll("[.!?]+$","");
    }

    public Map<String,Object> saveReviewField(long reviewCaseId,String requestedFieldKey,ReviewFieldDecision r) {
        var a=actor();require(a,"REVIEWER");var review=accessibleReviewCase(a,reviewCaseId,true);
        state(!"COMPLETED".equals(review.get("status")),"Review case đã hoàn tất");
        String key=fieldKey(requestedFieldKey);
        var left=annotationMap(nullableId(review,"left_task_id"));var right=annotationMap(nullableId(review,"right_task_id"));
        valid(left.containsKey(key)||right.containsKey(key),"Section không tồn tại trong hai kết quả nguồn");
        var l=left.get(key);var rr=right.get(key);String type=comparisonType(l==null?null:(String)l.get("label_value"),rr==null?null:(String)rr.get("label_value"));
        String name=String.valueOf(l!=null?l.get("label_name"):rr.get("label_name"));
        var row=one("""
                INSERT INTO review_field_decisions(review_case_id,field_key,field_name,comparison_type,left_value,right_value,left_source_page,right_source_page,left_source_bbox,right_source_bbox,final_value,selected_source,feedback,reviewed_by,reviewed_at)
                VALUES (?,?,?,?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT (review_case_id,field_key) DO UPDATE SET field_name=EXCLUDED.field_name,comparison_type=EXCLUDED.comparison_type,left_value=EXCLUDED.left_value,right_value=EXCLUDED.right_value,left_source_page=EXCLUDED.left_source_page,right_source_page=EXCLUDED.right_source_page,left_source_bbox=EXCLUDED.left_source_bbox,right_source_bbox=EXCLUDED.right_source_bbox,final_value=EXCLUDED.final_value,selected_source=EXCLUDED.selected_source,feedback=EXCLUDED.feedback,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=CURRENT_TIMESTAMP
                RETURNING *
                """,reviewCaseId,key,name,type,l==null?null:l.get("label_value"),rr==null?null:rr.get("label_value"),l==null?null:l.get("source_page"),rr==null?null:rr.get("source_page"),l==null?null:l.get("source_bbox"),rr==null?null:rr.get("source_bbox"),r.finalValue().trim(),r.selectedSource(),r.feedback(),a.id());
        db.update("UPDATE review_cases SET status='IN_PROGRESS',started_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE id=?",reviewCaseId);
        audit(a,"RESOLVE_FIELD","REVIEW_CASE",reviewCaseId);return row;
    }

    public Map<String,Object> completeReviewCase(long reviewCaseId) {
        var a=actor();require(a,"REVIEWER");var review=accessibleReviewCase(a,reviewCaseId,true);
        state(!"COMPLETED".equals(review.get("status")),"Review case đã hoàn tất");
        requireAllDone(reviewerCompletion(a),"Chưa thể Approve Review");
        long leftId=nullableId(review,"left_task_id"),rightId=nullableId(review,"right_task_id");
        var left=annotationMap(leftId);var right=annotationMap(rightId);var keys=new TreeSet<String>();keys.addAll(left.keySet());keys.addAll(right.keySet());
        valid(!keys.isEmpty(),"Review case chưa có section để duyệt");
        for(String key:keys) {
            var l=left.get(key);var rr=right.get(key);String lv=l==null?null:(String)l.get("label_value"),rv=rr==null?null:(String)rr.get("label_value");
            if("EXACT".equals(comparisonType(lv,rv))&&count("SELECT count(*) FROM review_field_decisions WHERE review_case_id=? AND field_key=?",reviewCaseId,key)==0)
                db.update("INSERT INTO review_field_decisions(review_case_id,field_key,field_name,comparison_type,left_value,right_value,final_value,selected_source,reviewed_by,reviewed_at) VALUES (?,?,?,'EXACT',?,?,?,'LEFT',?,CURRENT_TIMESTAMP)",reviewCaseId,key,l.get("label_name"),lv,rv,lv,a.id());
        }
        state(count("SELECT count(*) FROM review_field_decisions WHERE review_case_id=? AND final_value IS NOT NULL AND btrim(final_value)<>''",reviewCaseId)==keys.size(),"Cần xác nhận giá trị cuối cùng cho tất cả section khác nhau");
        db.update("UPDATE review_cases SET status='COMPLETED',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),completed_at=CURRENT_TIMESTAMP WHERE id=?",reviewCaseId);
        db.update("UPDATE annotation_tasks SET status='APPROVED' WHERE id IN (?,?) AND status='SUBMITTED'",leftId,rightId);
        db.update("UPDATE task_section_progress SET status='REVIEWED',reviewed_at=CURRENT_TIMESTAMP WHERE task_id IN (?,?)",leftId,rightId);
        audit(a,"COMPLETE","REVIEW_CASE",reviewCaseId);return reviewCase(reviewCaseId);
    }

    public Map<String,Object> sessionCompletion(Long sessionId) {
        var a=actor();
        return switch(a.role()) {
            case "AI_LABELER", "MANUAL_LABELER" -> labelerCompletion(a,sessionId);
            case "REVIEWER" -> reviewerCompletion(a);
            case "RESULT_ANALYST" -> analystCompletion(a,sessionId);
            default -> throw error(HttpStatus.FORBIDDEN,"Vai trò không hỗ trợ trạng thái hoàn thành session");
        };
    }

    private Map<String,Object> labelerCompletion(Actor a,Long sessionId) {
        var params=new ArrayList<Object>();params.add(a.id());
        String sessionFilter;
        if(sessionId==null) sessionFilter=" AND t.session_id IS NULL";
        else {sessionFilter=" AND t.session_id=?";params.add(sessionId);}
        var tasks=db.queryForList("""
                SELECT t.id,t.status,d.title AS document_title
                FROM annotation_tasks t JOIN documents d ON d.id=t.document_id
                WHERE t.assigned_to=?"""+sessionFilter+" ORDER BY t.id",params.toArray());
        var documents=new ArrayList<Map<String,Object>>();
        for(var task:tasks) {
            long taskId=id(task,"id");
            var labels=new HashMap<String,Map<String,Object>>();
            for(var row:db.queryForList("SELECT label_name,label_value,source_page FROM annotations WHERE task_id=?",taskId))
                labels.put(fieldKey(String.valueOf(row.get("label_name"))),row);
            var missing=new ArrayList<String>();
            for(String required:REQUIRED_FINANCIAL_FIELDS) {
                var row=labels.get(required);
                if(row==null||row.get("label_value")==null||String.valueOf(row.get("label_value")).isBlank()) missing.add(required);
                else if(row.get("source_page")==null) missing.add(required+" (Source Page)");
            }
            String status=missing.isEmpty()?"done":labels.isEmpty()?"pending":"processing";
            documents.add(completionDocument(taskId,String.valueOf(task.get("document_title")),status,missing));
        }
        return completionResult(documents);
    }

    private Map<String,Object> reviewerCompletion(Actor a) {
        var documents=new ArrayList<Map<String,Object>>();
        for(var summary:reviewCases(null)) {
            long caseId=id(summary,"id");
            var detail=reviewCase(caseId);
            @SuppressWarnings("unchecked") var fields=(List<Map<String,Object>>)detail.getOrDefault("fields",List.of());
            var missing=new ArrayList<String>();int decided=0;
            for(var field:fields) {
                if(!"EXACT".equals(field.get("comparisonType"))) {
                    Object finalValue=field.get("finalValue"),selected=field.get("selectedSource");
                    if(finalValue==null||String.valueOf(finalValue).isBlank()||selected==null) missing.add(String.valueOf(field.get("fieldName")));
                    else decided++;
                }
            }
            String status=missing.isEmpty()?"done":decided>0||"IN_PROGRESS".equals(summary.get("status"))?"processing":"pending";
            var row=completionDocument(caseId,String.valueOf(summary.get("document_title")),status,missing);
            row.put("missingCount",missing.size());documents.add(row);
        }
        return completionResult(documents);
    }

    private Map<String,Object> analystCompletion(Actor a,Long sessionId) {
        var args=new ArrayList<Object>();String filter="";
        if(sessionId!=null){filter=" AND t.session_id=?";args.add(sessionId);}
        var tasks=db.queryForList("SELECT t.id,d.title AS document_title FROM annotation_tasks t JOIN documents d ON d.id=t.document_id WHERE t.task_type='AI'"+filter+" ORDER BY t.id",args.toArray());
        var documents=new ArrayList<Map<String,Object>>();
        for(var task:tasks) {
            long taskId=id(task,"id");
            var runs=db.queryForList("""
                    SELECT run_id,max(created_at) AS created_at FROM ai_labeler_results
                    WHERE task_id=? GROUP BY run_id ORDER BY max(created_at) DESC LIMIT 2
                    """,taskId);
            var missing=new ArrayList<String>();int handled=0;
            if(runs.size()<2) missing.add("Chưa có đủ 2 lần chạy AI để so sánh");
            else {
                Object leftRun=runs.get(0).get("run_id"),rightRun=runs.get(1).get("run_id");
                var left=aiRunMap(taskId,leftRun);
                var right=aiRunMap(taskId,rightRun);
                var keys=new TreeSet<String>();keys.addAll(left.keySet());keys.addAll(right.keySet());
                for(String key:keys) {
                    var l=left.get(key);var r=right.get(key);
                    String lv=l==null||l.get("indicator_value")==null?null:String.valueOf(l.get("indicator_value"));
                    String rv=r==null||r.get("indicator_value")==null?null:String.valueOf(r.get("indicator_value"));
                    if("EXACT".equals(comparisonType(lv,rv))) continue;
                    var actions=db.queryForList("SELECT note,redo_confirmed FROM result_analysis_actions WHERE task_id=? AND field_key=?",taskId,key);
                    boolean done=!actions.isEmpty()&&((actions.getFirst().get("note")!=null&&!String.valueOf(actions.getFirst().get("note")).isBlank())||Boolean.TRUE.equals(actions.getFirst().get("redo_confirmed")));
                    if(done)handled++;else missing.add(key);
                }
            }
            String status=missing.isEmpty()?"done":handled>0?"processing":"pending";
            documents.add(completionDocument(taskId,String.valueOf(task.get("document_title")),status,missing));
        }
        return completionResult(documents);
    }

    private Map<String,Map<String,Object>> aiRunMap(long taskId,Object runId) {
        var result=new LinkedHashMap<String,Map<String,Object>>();
        for(var row:db.queryForList("SELECT indicator_name,indicator_value FROM ai_labeler_results WHERE task_id=? AND run_id=?",taskId,runId))
            result.put(fieldKey(String.valueOf(row.get("indicator_name"))),row);
        return result;
    }

    private Map<String,Object> completionDocument(long id,String name,String status,List<String> missing) {
        var row=new LinkedHashMap<String,Object>();row.put("id",id);row.put("name",name);row.put("status",status);row.put("missingDetail",missing);return row;
    }
    private Map<String,Object> completionResult(List<Map<String,Object>> documents) {
        var missingItems=new ArrayList<Map<String,Object>>();
        for(var document:documents) if(!"done".equals(document.get("status"))) {
            var item=new LinkedHashMap<String,Object>();item.put("id",document.get("id"));item.put("fileName",document.get("name"));item.put("detail",document.get("missingDetail"));missingItems.add(item);
        }
        var result=new LinkedHashMap<String,Object>();result.put("documents",documents);result.put("missingItems",missingItems);result.put("allDone",!documents.isEmpty()&&missingItems.isEmpty());return result;
    }
    private void requireAllDone(Map<String,Object> completion,String title) {
        if(Boolean.TRUE.equals(completion.get("allDone")))return;
        @SuppressWarnings("unchecked") var items=(List<Map<String,Object>>)completion.getOrDefault("missingItems",List.of());
        String detail=items.stream().map(item->item.get("fileName")+" — thiếu: "+item.get("detail")).reduce((a,b)->a+"; "+b).orElse("Không có file hợp lệ");
        throw error(HttpStatus.CONFLICT,title+". "+detail);
    }

    public Map<String,Object> saveAnalysisField(long taskId,String requestedFieldKey,AnalysisFieldAction request) {
        var a=actor();require(a,"RESULT_ANALYST");
        state(canReadTask(a,taskId),"Bạn không được phân tích task này");
        String key=fieldKey(requestedFieldKey);
        valid((request.note()!=null&&!request.note().isBlank())||Boolean.TRUE.equals(request.redoConfirmed()),"Cần nhập NOTE hoặc xác nhận kết quả redo");
        var row=one("""
                INSERT INTO result_analysis_actions(task_id,field_key,note,redo_run_id,redo_confirmed,updated_by)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT (task_id,field_key) DO UPDATE SET note=COALESCE(EXCLUDED.note,result_analysis_actions.note),redo_run_id=COALESCE(EXCLUDED.redo_run_id,result_analysis_actions.redo_run_id),redo_confirmed=EXCLUDED.redo_confirmed,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP
                RETURNING *
                """,taskId,key,request.note(),request.redoRunId(),request.redoConfirmed(),a.id());
        audit(a,"RESOLVE_FIELD","RESULT_ANALYSIS",taskId);return row;
    }

    public Map<String,Object> completeAnalysis(Long sessionId) {
        var a=actor();require(a,"RESULT_ANALYST");var completion=analystCompletion(a,sessionId);requireAllDone(completion,"Chưa thể Complete Analysis");
        var taskIds=new ArrayList<Long>();
        @SuppressWarnings("unchecked") var documents=(List<Map<String,Object>>)completion.get("documents");
        for(var document:documents){long taskId=((Number)document.get("id")).longValue();taskIds.add(taskId);db.update("INSERT INTO result_analysis_completions(task_id,completed_by) VALUES (?,?) ON CONFLICT (task_id) DO UPDATE SET completed_by=EXCLUDED.completed_by,completed_at=CURRENT_TIMESTAMP",taskId,a.id());audit(a,"COMPLETE","RESULT_ANALYSIS",taskId);}
        var result=new LinkedHashMap<String,Object>();result.put("completedTaskIds",taskIds);result.put("completion",completion);return result;
    }
    private Map<String,Object> normalizeTerm(Map<String,Object> source) {
        var row = new LinkedHashMap<String,Object>(source);
        row.put("synonyms", readJson(source.get("synonyms"), List.class, List.of()));
        row.put("related_term_ids", readJson(source.get("related_term_ids"), List.class, List.of()));
        return row;
    }
    public List<Map<String,Object>> terms() { actor();return db.queryForList("SELECT id,term,definition,category,status,abbreviation,synonyms::text AS synonyms,related_term_ids::text AS related_term_ids,example_usage,created_by,created_at,updated_at FROM terminology_entries ORDER BY term").stream().map(this::normalizeTerm).toList(); }
    public Map<String,Object> saveTerm(Long termId,Term r) {
        var a=actor();require(a,"TERMINOLOGY");valid(Set.of("ACTIVE","INACTIVE").contains(r.status()),"Trạng thái thuật ngữ không hợp lệ");
        var synonyms = r.synonyms() == null ? List.<String>of() : r.synonyms().stream().map(String::trim).filter(s -> !s.isBlank()).distinct().toList();
        var related = r.relatedTermIds() == null ? List.<Long>of() : r.relatedTermIds().stream().distinct().toList();
        for (Long relatedId : related) { valid(!Objects.equals(termId, relatedId), "Thuật ngữ không thể liên kết với chính nó"); valid(count("SELECT count(*) FROM terminology_entries WHERE id=?", relatedId) > 0, "Thuật ngữ liên quan không tồn tại"); }
        Map<String,Object> old = termId == null ? null : normalizeTerm(one("SELECT id,term,definition,category,status,abbreviation,synonyms::text AS synonyms,related_term_ids::text AS related_term_ids,example_usage,created_by,created_at,updated_at FROM terminology_entries WHERE id=? FOR UPDATE", termId));
        Map<String,Object> row;
        if(termId==null) row=one("INSERT INTO terminology_entries(term,definition,category,status,abbreviation,synonyms,related_term_ids,example_usage,created_by) VALUES (?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb),?,?) RETURNING *",r.term().trim(),r.definition(),r.category(),r.status(),r.abbreviation(),jsonValue(synonyms),jsonValue(related),r.exampleUsage(),a.id());
        else row=one("UPDATE terminology_entries SET term=?,definition=?,category=?,status=?,abbreviation=?,synonyms=CAST(? AS jsonb),related_term_ids=CAST(? AS jsonb),example_usage=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *",r.term().trim(),r.definition(),r.category(),r.status(),r.abbreviation(),jsonValue(synonyms),jsonValue(related),r.exampleUsage(),termId);
        row=normalizeTerm(row);
        db.update("INSERT INTO term_audit_logs(term_id,term_name,actor_id,action,old_values,new_values) VALUES (?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb))",id(row,"id"),row.get("term"),a.id(),termId==null?"CREATED":"UPDATED",old==null?null:jsonValue(old),jsonValue(row));
        audit(a,termId==null?"CREATE":"UPDATE","TERM",id(row,"id"));return row;
    }
    public void deleteTerm(long termId) {
        var a=actor();require(a,"TERMINOLOGY");var old=normalizeTerm(one("SELECT id,term,definition,category,status,abbreviation,synonyms::text AS synonyms,related_term_ids::text AS related_term_ids,example_usage,created_by,created_at,updated_at FROM terminology_entries WHERE id=? FOR UPDATE",termId));
        db.update("INSERT INTO term_audit_logs(term_id,term_name,actor_id,action,old_values,new_values) VALUES (?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb))",termId,old.get("term"),a.id(),"DELETED",jsonValue(old),null);
        one("DELETE FROM terminology_entries WHERE id=? RETURNING id",termId);audit(a,"DELETE","TERM",termId);
    }
    public List<Map<String,Object>> termAuditLogs(Long userId,Long termId) {
        var a=actor();require(a,"TERMINOLOGY","ADMIN");var sql=new StringBuilder("SELECT l.id,l.term_id,l.term_name,l.action,l.old_values::text AS old_values,l.new_values::text AS new_values,l.created_at,u.id AS actor_id,u.username FROM term_audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE 1=1");var args=new ArrayList<Object>();
        if(userId!=null){sql.append(" AND l.actor_id=?");args.add(userId);}if(termId!=null){sql.append(" AND l.term_id=?");args.add(termId);}sql.append(" ORDER BY l.created_at DESC,l.id DESC LIMIT 500");
        return db.queryForList(sql.toString(),args.toArray()).stream().map(source->{var row=new LinkedHashMap<String,Object>(source);row.put("old_values",readJson(source.get("old_values"),Map.class,Map.of()));row.put("new_values",readJson(source.get("new_values"),Map.class,Map.of()));return (Map<String,Object>)row;}).toList();
    }
    public List<Map<String,Object>> prompts() {
        var a=actor();require(a,"AI_LABELER");return db.queryForList("SELECT * FROM prompt_templates WHERE created_by=? ORDER BY id DESC",a.id());
    }
    public List<Map<String,Object>> promptOptions() {
        var a=actor();require(a,"AI_LABELER","MANUAL_LABELER");
        return db.queryForList("SELECT id,name,description,content,model,is_active,created_by,created_at,updated_at FROM prompt_templates WHERE is_active=true ORDER BY model NULLS LAST, id DESC");
    }
    public Map<String,Object> savePrompt(Long promptId,Prompt r) {
        var a=actor();require(a,"AI_LABELER");Map<String,Object> row;
        if(promptId==null) row=one("INSERT INTO prompt_templates(name,description,content,model,is_active,created_by) VALUES (?,?,?,?,?,?) RETURNING *",r.name(),r.description(),r.content(),r.model(),r.active(),a.id());
        else {
            owns(a,one("SELECT * FROM prompt_templates WHERE id=? FOR UPDATE",promptId),"created_by");
            row=one("UPDATE prompt_templates SET name=?,description=?,content=?,model=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *",r.name(),r.description(),r.content(),r.model(),r.active(),promptId);
        }
        audit(a,promptId==null?"CREATE":"UPDATE","PROMPT",id(row,"id"));return row;
    }
    public void deletePrompt(long promptId) {
        var a=actor();require(a,"AI_LABELER");owns(a,one("SELECT * FROM prompt_templates WHERE id=? FOR UPDATE",promptId),"created_by");
        db.update("DELETE FROM prompt_templates WHERE id=?",promptId);audit(a,"DELETE","PROMPT",promptId);
    }
    public Map<String,Object> dashboard() {
        var a=actor(); if (a.role().equals("ADMIN") || a.role().equals("MANAGER")) requirePermission(a, "DASHBOARD", "READ");
        var data=new LinkedHashMap<String,Object>();
        if(a.role().equals("ADMIN")) {
            data.put("Tài khoản",count("SELECT count(*) FROM users"));data.put("Đang hoạt động",count("SELECT count(*) FROM users WHERE is_active=true"));
            data.put("Nhật ký",count("SELECT count(*) FROM audit_logs"));
        } else if(a.role().equals("TERMINOLOGY")) {
            data.put("Thuật ngữ",count("SELECT count(*) FROM terminology_entries"));data.put("Đang sử dụng",count("SELECT count(*) FROM terminology_entries WHERE status='ACTIVE'"));
            data.put("Nhóm chủ đề",count("SELECT count(DISTINCT category) FROM terminology_entries WHERE category<>''"));
        } else {
            data.put("Tác vụ",count("SELECT count(*) FROM annotation_tasks t WHERE "+taskScope(a)));
            data.put("Chờ duyệt",count("SELECT count(*) FROM annotation_tasks t WHERE ("+taskScope(a)+") AND status='SUBMITTED'"));
            data.put("Đã duyệt",count("SELECT count(*) FROM annotation_tasks t WHERE ("+taskScope(a)+") AND status='APPROVED'"));
        }
        return data;
    }
    public Map<String,Object> statistics() { return statistics(null,null,null); }
    public Map<String,Object> statistics(Long sessionId,LocalDateTime from,LocalDateTime to) {
        var a=actor();require(a,"MANAGER","RESULT_ANALYST");
        if (a.role().equals("MANAGER")) requirePermission(a, "STATISTICS", "READ");
        if(from!=null&&to!=null) valid(!from.isAfter(to),"Khoảng thời gian thống kê không hợp lệ");
        StringBuilder where=new StringBuilder(taskScope(a));var args=new ArrayList<Object>();
        if(sessionId!=null){where.append(" AND t.session_id=?");args.add(sessionId);}
        if(from!=null){where.append(" AND t.created_at>=?");args.add(from);}
        if(to!=null){where.append(" AND t.created_at<=?");args.add(to);}
        String scope=where.toString();Object[] values=args.toArray();
        var data=new LinkedHashMap<String,Object>();
        data.put("statuses",db.queryForList("SELECT t.status,count(*) AS total FROM annotation_tasks t WHERE "+scope+" GROUP BY t.status ORDER BY t.status",values));
        data.put("labels",db.queryForList("SELECT n.label_name,count(*) AS total,avg(n.confidence) AS average_confidence FROM annotations n JOIN annotation_tasks t ON t.id=n.task_id WHERE "+scope+" GROUP BY n.label_name ORDER BY total DESC",values));
        data.put("assignees",db.queryForList("SELECT u.username,count(*) AS total,count(*) FILTER (WHERE t.status='APPROVED') AS approved,count(*) FILTER (WHERE t.due_at<CURRENT_TIMESTAMP AND t.status NOT IN ('APPROVED','REJECTED')) AS overdue FROM annotation_tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE "+scope+" GROUP BY u.username ORDER BY total DESC",values));
        data.put("sectionProgress",db.queryForList("""
                SELECT t.id AS task_id,t.session_id,d.title AS document_title,u.username,t.assistance_mode,
                       sp.field_key,sp.field_name,sp.status AS section_status,t.status AS task_status,t.due_at,
                       CASE WHEN t.status='APPROVED' THEN 'COMPLETED'
                            WHEN t.due_at<CURRENT_TIMESTAMP AND t.status NOT IN ('APPROVED','REJECTED') THEN 'OVERDUE'
                            WHEN t.status='PENDING' THEN 'PENDING' ELSE 'IN_PROGRESS' END AS deadline_status
                FROM annotation_tasks t JOIN documents d ON d.id=t.document_id
                LEFT JOIN users u ON u.id=t.assigned_to
                LEFT JOIN task_section_progress sp ON sp.task_id=t.id
                WHERE (1=1)""" + " AND (" + scope + ") ORDER BY t.due_at NULLS LAST,t.id,sp.field_name",values));
        data.put("userProductivity",db.queryForList("""
                SELECT u.id AS user_id,u.username,count(DISTINCT t.id) AS assigned_tasks,
                       count(DISTINCT t.id) FILTER (WHERE t.status IN ('SUBMITTED','APPROVED')) AS submitted_tasks,
                       count(DISTINCT t.id) FILTER (WHERE t.status='APPROVED') AS completed_tasks,
                       count(sp.id) FILTER (WHERE sp.status='SAVED') AS saved_sections,
                       count(sp.id) FILTER (WHERE sp.status='SUBMITTED') AS submitted_sections,
                       count(sp.id) FILTER (WHERE sp.status='REVIEWED') AS reviewed_sections,
                       count(DISTINCT t.id) FILTER (WHERE t.due_at<CURRENT_TIMESTAMP AND t.status NOT IN ('APPROVED','REJECTED')) AS overdue_tasks
                FROM annotation_tasks t LEFT JOIN users u ON u.id=t.assigned_to
                LEFT JOIN task_section_progress sp ON sp.task_id=t.id
                WHERE (1=1)""" + " AND (" + scope + ") GROUP BY u.id,u.username ORDER BY completed_tasks DESC,u.username",values));
        data.put("timeComparison",db.queryForList("""
                SELECT t.assistance_mode,count(DISTINCT t.id) AS sample_size,
                       round(avg(w.total_seconds)::numeric,2) AS average_seconds,
                       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY w.total_seconds)::numeric,2) AS median_seconds
                FROM annotation_tasks t
                JOIN (SELECT task_id,sum(active_seconds) AS total_seconds FROM work_time_entries WHERE task_id IS NOT NULL GROUP BY task_id) w ON w.task_id=t.id
                WHERE (1=1)""" + " AND (" + scope + ") AND t.task_type='MANUAL' AND t.status IN ('SUBMITTED','APPROVED') GROUP BY t.assistance_mode ORDER BY t.assistance_mode",values));
        data.put("overdueTasks",db.queryForList("SELECT t.id,d.title AS document_title,u.username,t.status,t.due_at,t.assistance_mode FROM annotation_tasks t JOIN documents d ON d.id=t.document_id LEFT JOIN users u ON u.id=t.assigned_to WHERE ("+scope+") AND t.due_at<CURRENT_TIMESTAMP AND t.status NOT IN ('APPROVED','REJECTED') ORDER BY t.due_at",values));
        if(a.role().equals("MANAGER")) data.put("reviewCases",reviewCases(null));
        return data;
    }
}
