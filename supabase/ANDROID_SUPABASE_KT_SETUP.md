# Setup Detail Android + Supabase (Postgrest + Realtime WebSocket)

Panduan ini menyusun implementasi dari nol sampai live update berjalan di Android.

## 1) Siapkan tabel dan policy di Supabase

Jalankan SQL berikut di Supabase SQL Editor.

~~~sql
create table if not exists public.todos (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

-- Buka akses baca untuk role authenticated
create policy if not exists todos_select_authenticated
on public.todos
for select
to authenticated
using (true);

-- Buka akses insert untuk role authenticated
create policy if not exists todos_insert_authenticated
on public.todos
for insert
to authenticated
with check (true);

-- Aktifkan stream Realtime dari Postgres changes
alter publication supabase_realtime add table public.todos;
~~~

Catatan:
- Jika aplikasi client memakai publishable key tanpa login user, biasanya request akan dianggap anon.
- Jika perlu akses anon, buat policy terpisah untuk role anon.

## 2) Dependency Gradle

Di module app, tambahkan plugin serialization jika belum ada.

~~~kotlin
plugins {
    kotlin("plugin.serialization") version "<kotlin-version>"
}
~~~

Tambahkan dependency library.

~~~kotlin
dependencies {
    implementation("io.github.jan-tennert.supabase:supabase-kt:VERSION")
    implementation("io.github.jan-tennert.supabase:postgrest-kt:VERSION")
    implementation("io.github.jan-tennert.supabase:realtime-kt:VERSION")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
~~~

## 3) Permission internet Android

Di AndroidManifest.xml pastikan ada permission internet.

~~~xml
<uses-permission android:name="android.permission.INTERNET" />
~~~

## 4) Buat client Supabase terpusat

Buat object singleton agar tidak create client berulang.

~~~kotlin
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime

object SupabaseProvider {
    val client = createSupabaseClient(
        supabaseUrl = "https://zqblnkmcidhqamfgpqwa.supabase.co",
        supabaseKey = "sb_publishable_W650oJSdb4Wnj5F971ccbA_i5nYMyYV"
    ) {
        install(Postgrest)
        install(Realtime)
    }
}
~~~

## 5) Model data

~~~kotlin
import kotlinx.serialization.Serializable

@Serializable
data class TodoItem(
    val id: Long,
    val name: String,
    val created_at: String? = null
)
~~~

## 6) Repository (Postgrest)

Pisahkan query agar UI tetap bersih.

~~~kotlin
import io.github.jan.supabase.postgrest.from

class TodoRepository {
    private val supabase = SupabaseProvider.client

    suspend fun fetchTodos(): List<TodoItem> {
        return supabase
            .from("todos")
            .select()
            .decodeList<TodoItem>()
    }

    suspend fun insertTodo(name: String) {
        supabase
            .from("todos")
            .insert(mapOf("name" to name))
    }
}
~~~

## 7) ViewModel (state + realtime websocket)

~~~kotlin
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.postgres.PostgresAction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

class TodoViewModel : ViewModel() {
    private val repo = TodoRepository()
    private val supabase = SupabaseProvider.client

    private val _items = MutableStateFlow<List<TodoItem>>(emptyList())
    val items: StateFlow<List<TodoItem>> = _items.asStateFlow()

    private var channel: RealtimeChannel? = null

    init {
        loadInitial()
        startRealtime()
    }

    private fun loadInitial() {
        viewModelScope.launch {
            _items.value = repo.fetchTodos()
        }
    }

    fun addTodo(name: String) {
        viewModelScope.launch {
            repo.insertTodo(name)
        }
    }

    private fun startRealtime() {
        viewModelScope.launch {
            supabase.realtime.connect()

            val ch = supabase.channel("todos-live")
            channel = ch

            ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                table = "todos"
            }.onEach { change ->
                val newTodo = change.record.decodeAs<TodoItem>()
                _items.value = listOf(newTodo) + _items.value
            }.launchIn(this)

            ch.subscribe()
        }
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch {
            channel?.unsubscribe()
            supabase.realtime.disconnect()
        }
    }
}
~~~

## 8) Compose UI

~~~kotlin
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    TodoListScreen()
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
fun TodoListScreen(vm: TodoViewModel = viewModel()) {
    val items by vm.items.collectAsState()

    LazyColumn {
        items(items, key = { it.id }) { item ->
            Text(
                text = item.name,
                modifier = Modifier.padding(8.dp)
            )
        }
    }
}
~~~

## 9) Checklist debug jika realtime belum jalan

1. Cek publication:

~~~sql
select *
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'todos';
~~~

2. Cek RLS policy benar-benar ada untuk role yang dipakai.
3. Cek request error di logcat (401 atau 403 biasanya policy/key).
4. Cek koneksi websocket tersambung (realtime.connect berhasil).
5. Coba insert row manual di SQL Editor; lihat apakah event masuk ke app.

## 10) Keamanan

- Publishable key aman untuk client.
- Jangan taruh service_role key di aplikasi Android.
- Untuk production, idealnya user login dulu lalu policy berbasis user id.
