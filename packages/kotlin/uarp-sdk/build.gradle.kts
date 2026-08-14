plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    `java-library`
    `maven-publish`
    signing
}

kotlin {
    compilerOptions {
        // Java 11 bytecode keeps the artifact consumable by Android (minSdk 21+
        // with desugaring) and by any modern JVM.
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
    explicitApi()
}

java {
    withSourcesJar()
    withJavadocJar()
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(11)
}

dependencies {
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}

tasks.test {
    useJUnitPlatform()
}

//  Runs the contract runner from the test source set, so it never ships.
tasks.register<JavaExec>("contract") {
    group = "verification"
    description = "Run the cross-SDK contract scenarios against UARP_CONTRACT_BASE_URL"
    mainClass.set("ai.snaga.uarp.ContractRunnerKt")
    classpath = sourceSets["test"].runtimeClasspath
}

//  Same idea for the live runner: it talks to a real server, so it stays in
//  the test source set and never ships.
tasks.register<JavaExec>("live") {
    group = "verification"
    description = "Run the live scenario against UARP_BASE_URL using UARP_API_KEY"
    mainClass.set("ai.snaga.uarp.LiveRunnerKt")
    classpath = sourceSets["test"].runtimeClasspath
    environment("UARP_API_KEY", System.getenv("UARP_API_KEY") ?: "")
    environment("UARP_BASE_URL", System.getenv("UARP_BASE_URL") ?: "https://api.snaga.ai")
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = "uarp-sdk"
            from(components["java"])
            pom {
                name.set("UARP SDK")
                description.set(
                    "Kotlin/Android client for the UARP (Snaga) Universal Agent Runtime Platform API",
                )
                url.set("https://github.com/snaga-ai/uarp-sdks")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("snaga")
                        name.set("Snaga")
                        email.set("support@snaga.ai")
                    }
                }
                scm {
                    url.set("https://github.com/snaga-ai/uarp-sdks")
                    connection.set("scm:git:https://github.com/snaga-ai/uarp-sdks.git")
                    developerConnection.set("scm:git:ssh://git@github.com/snaga-ai/uarp-sdks.git")
                }
            }
        }
    }

    repositories {
        maven {
            name = "central"
            url = uri(
                if (version.toString().endsWith("SNAPSHOT")) {
                    "https://central.sonatype.com/repository/maven-snapshots/"
                } else {
                    "https://central.sonatype.com/api/v1/publisher/upload"
                },
            )
            credentials {
                username = findProperty("mavenUsername") as String?
                password = findProperty("mavenPassword") as String?
            }
        }
    }
}

signing {
    // Only sign when a key is supplied, so local builds and CI checks stay simple.
    val signingKey = findProperty("signingKey") as String?
    val signingPassword = findProperty("signingPassword") as String?
    if (signingKey != null) {
        useInMemoryPgpKeys(signingKey, signingPassword)
        sign(publishing.publications["maven"])
    }
}
