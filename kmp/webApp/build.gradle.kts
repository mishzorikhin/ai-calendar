import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.targets.js.webpack.KotlinWebpackConfig

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// 8080 занят Go-сервером, поэтому dev-сервер веба слушает 8088.
fun KotlinWebpackConfig.devOn8088() {
    devServer = (devServer ?: KotlinWebpackConfig.DevServer()).apply {
        port = 8088
        open = false
    }
}

kotlin {
    js {
        browser {
            commonWebpackConfig { devOn8088() }
        }
        binaries.executable()
    }

    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        browser {
            commonWebpackConfig { devOn8088() }
        }
        binaries.executable()
    }

    sourceSets {
        commonMain.dependencies {
            implementation(projects.shared)
            implementation(compose.ui)
        }
    }
}
