package com.forgesense.security;

import com.forgesense.ForgeSenseBackendApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end RBAC enforcement: read endpoints require any authenticated user,
 * maintenance and simulation actions require ENGINEER, alert acknowledgement
 * is open to OPERATOR, alert resolution requires ENGINEER.
 */
@SpringBootTest(classes = ForgeSenseBackendApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:rbac;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "forgesense.streaming.kafka.enabled=false",
        "forgesense.security.enabled=true",
        "forgesense.simulation.poll-enabled=false",
})
@AutoConfigureMockMvc
class SecurityRbacIntegrationTest {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private ObjectMapper objectMapper;

    private String login(String username) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("username", username, "password", "forgesense-dev"))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        return body.get("accessToken").asText();
    }

    @Test
    void anonymousAccessIsRejected() throws Exception {
        mvc.perform(get("/api/v1/machines")).andExpect(status().isUnauthorized());
    }

    @Test
    void anyAuthenticatedUserCanRead() throws Exception {
        String token = login("operator");
        mvc.perform(get("/api/v1/machines").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/alerts").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/maintenance").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void operatorCannotRunSimulations() throws Exception {
        String token = login("operator");
        mvc.perform(post("/api/v1/simulation/control/M-101/clear")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void engineerCanRunSimulations() throws Exception {
        String token = login("engineer");
        mvc.perform(post("/api/v1/simulation/control/M-101/clear")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void operatorCannotScheduleMaintenance() throws Exception {
        String token = login("operator");
        mvc.perform(post("/api/v1/maintenance/" + UUID.randomUUID() + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void engineerCanActOnMaintenance() throws Exception {
        String token = login("engineer");
        MvcResult res = mvc.perform(get("/api/v1/maintenance")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = objectMapper.readTree(res.getResponse().getContentAsString());
        JsonNode items = body.get("items");
        if (items == null || items.isEmpty()) {
            return; // no seeded maintenance records to act on
        }
        String id = items.get(0).get("id").asText();
        MvcResult act = mvc.perform(post("/api/v1/maintenance/" + id + "/complete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"engineer test\"}")
                        .header("Authorization", "Bearer " + token))
                .andReturn();
        assertThat(act.getResponse().getStatus()).isLessThan(403); // authorized: 200/4xx but not 403
    }

    @Test
    void operatorCanAcknowledgeAlerts() throws Exception {
        String token = login("operator");
        // unknown id -> 404 proves the request PASSED the role check
        mvc.perform(post("/api/v1/alerts/" + UUID.randomUUID() + "/acknowledge")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void operatorCannotResolveAlerts() throws Exception {
        String token = login("operator");
        mvc.perform(post("/api/v1/alerts/" + UUID.randomUUID() + "/resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"nope\"}")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void engineerCanResolveAlerts() throws Exception {
        String token = login("engineer");
        // passes the role check; unknown id -> 404
        mvc.perform(post("/api/v1/alerts/" + UUID.randomUUID() + "/resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"notes\":\"engineer notes\"}")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void loginReportsConfiguredExpiry() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("username", "engineer", "password", "forgesense-dev"))))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.get("expiresInSeconds").asLong()).isEqualTo(86400L);
        assertThat(body.get("roles").toString()).contains("ROLE_ENGINEER");
    }
}